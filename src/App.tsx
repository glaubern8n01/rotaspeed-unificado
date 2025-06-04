import React, { useEffect, useReducer, createContext, useContext, useState, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import type { AppState, AppAction, User, PackageInfo, AddressInfo, RouteStop, ParsedAddressFromAI, UserCoordinates, EntregaDbRecord } from './types';
import { AppPhase, InputType } from './types';
import { Button, Input, Modal, Spinner, Textarea, Alert, UserIcon, LockClosedIcon, PackageIcon, CameraIcon, MicrophoneIcon, DocumentTextIcon, UploadIcon, MapPinIcon, CheckCircleIcon, XCircleIcon, TrashIcon, ArrowPathIcon, PaperAirplaneIcon, WhatsAppIcon, InformationCircleIcon, RadioGroup, ListBulletIcon, Bars3Icon, ArrowUpIcon, ArrowDownIcon, ExclamationTriangleIcon, ShareIcon, CreditCardIcon, CloseIcon } from './uiComponents';
import useSpeechRecognition from './speechService';
import { convertImageToBase64, extractTextFromPdf, extractTextFromSheet, loadPdfJs, loadXlsx } from './fileProcessingService';
import { parseAddressFromTextWithGemini, parseAddressFromImageWithGemini, optimizeRouteWithGemini } from './geminiService';
// FIX: Import mapping functions from supabaseClient
import { supabase, getUserProfile, /* createUserProfile, */ addEntrega, getEntregasByUserId, deleteEntrega, updateEntregaStatus, EntregaData, updateUserProfileSettings, addMultipleEntregas, updateMultipleEntregasOptimization, mapDBStatusToPackageStatus, mapPackageStatusToDBStatus, invokeSyncUserProfile } from './supabaseClient'; 
import { GoogleIcon } from './uiComponents'; // Assuming GoogleIcon is added to uiComponents

const initialState: AppState = {
  phase: AppPhase.LOGIN,
  user: null,
  totalPackagesEstimate: 0,
  packages: [], // Will be populated from Supabase 'entregas' table
  optimizedRoute: [],
  currentStopIndex: 0,
  isLoading: false,
  isFetchingLocation: false,
  errorMessage: null,
  successMessage: null,
  infoMessage: null,
  isMicrophoneAvailable: false,
  isSpeechRecognitionSupported: false,
  userLocation: null,
  manualOriginAddress: null,
  optimizationMode: 'auto',
  showPlanLimitModal: false,
  showUpgradeModal: false, 
  showNotifyAllModal: false,
  showCameraModal: false,
  showManualOriginModal: false,
  isAuthenticating: true, 
  showPasswordResetModal: false,
  passwordResetEmailSent: false,
};

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<AppAction> } | undefined>(undefined);

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload,
        phase: action.payload.plano_ativo ? AppPhase.PACKAGE_COUNT_SETUP : AppPhase.PLAN_EXPIRED,
        errorMessage: null,
        successMessage: null,
        // infoMessage: null, // Keep info message if profile was just created
        userLocation: null,
        manualOriginAddress: null,
        isAuthenticating: false,
        packages: [], // Clear local packages, will be fetched
        optimizedRoute: [], // Clear local route
      };
    case 'LOGOUT':
      return { ...initialState, isAuthenticating: false, phase: AppPhase.LOGIN };
    case 'SET_TOTAL_PACKAGES_ESTIMATE':
      return { ...state, totalPackagesEstimate: action.payload, phase: AppPhase.PACKAGE_INPUT };
    case 'ADD_PACKAGES': { // Can be used for adding newly parsed packages before DB save confirmation
      const newPackages = action.payload.filter(
        p => !state.packages.some(existing => existing.id === p.id)
      );
      return { ...state, packages: [...state.packages, ...newPackages] };
    }
     case 'SET_PACKAGES': // Used to set packages after fetching from DB
      return { ...state, packages: action.payload };
    case 'UPDATE_PACKAGE': // Can be used for optimistic UI update or after DB confirm
      return {
        ...state,
        packages: state.packages.map(p => p.id === action.payload.id ? action.payload : p),
      };
    case 'REMOVE_PACKAGE':
      return { ...state, packages: state.packages.filter(p => p.id !== action.payload) };
    case 'SET_OPTIMIZED_ROUTE': {
      let nextPhase = AppPhase.DELIVERY;
       if (state.user && !state.user.plano_ativo) {
        nextPhase = AppPhase.PLAN_EXPIRED;
      } else if (state.user && state.user.plano_nome === 'Grátis' && state.user.entregas_gratis_utilizadas >= state.user.entregas_dia_max) {
        nextPhase = AppPhase.LIMIT_REACHED;
      } else if (state.user && state.user.plano_nome !== 'Grátis' && state.user.entregas_hoje >= state.user.entregas_dia_max) {
        nextPhase = AppPhase.LIMIT_REACHED;
      }
      return { ...state, optimizedRoute: action.payload, phase: nextPhase, currentStopIndex: 0, showNotifyAllModal: nextPhase === AppPhase.DELIVERY ? true : false };
    }
    case 'SET_MANUALLY_ORDERED_PACKAGES': {
        const manuallyOrderedRouteStops: RouteStop[] = action.payload.map((pkg, index) => ({
            ...pkg,
            order: index + 1,
            // status: 'pending', // Status should be 'in_transit' or similar
        }));
        let nextPhase = AppPhase.DELIVERY;
        if (state.user && !state.user.plano_ativo) {
            nextPhase = AppPhase.PLAN_EXPIRED;
        } else if (state.user && state.user.plano_nome === 'Grátis' && state.user.entregas_gratis_utilizadas >= state.user.entregas_dia_max) {
            nextPhase = AppPhase.LIMIT_REACHED;
        } else if (state.user && state.user.plano_nome !== 'Grátis' && state.user.entregas_hoje >= state.user.entregas_dia_max) {
            nextPhase = AppPhase.LIMIT_REACHED;
        }
        return { ...state, optimizedRoute: manuallyOrderedRouteStops, phase: nextPhase, currentStopIndex: 0, showNotifyAllModal: nextPhase === AppPhase.DELIVERY ? true : false };
    }
    // FIX: Renamed MARK_DELIVERED to UPDATE_PACKAGE_STATUS and use action.payload.newStatus
    case 'UPDATE_PACKAGE_STATUS': {
      const { id: packageId, newStatus } = action.payload;
      const updatedPackages = state.packages.map(p => p.id === packageId ? { ...p, status: newStatus } : p);
      const updatedRoute = state.optimizedRoute.map(r => r.id === packageId ? { ...r, status: newStatus } : r);
      // FIX: Check against newStatus which will be 'delivered' or 'cancelled'
      const allDone = updatedRoute.every(r => r.status === 'delivered' || r.status === 'cancelled');
      return {
        ...state,
        packages: updatedPackages,
        optimizedRoute: updatedRoute,
        phase: allDone ? AppPhase.COMPLETED : state.phase,
      };
    }
    case 'NEXT_STOP': {
        const nextIndex = state.currentStopIndex + 1;
        if (nextIndex >= state.optimizedRoute.length) {
            return { ...state, phase: AppPhase.COMPLETED };
        }
        return { ...state, currentStopIndex: nextIndex };
    }
    case 'SET_PHASE':
      return { ...state, phase: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_FETCHING_LOCATION':
      return { ...state, isFetchingLocation: action.payload };
    case 'SET_ERROR_MESSAGE':
      return { ...state, errorMessage: action.payload, successMessage: null, infoMessage: null };
    case 'SET_SUCCESS_MESSAGE':
      return { ...state, successMessage: action.payload, errorMessage: null, infoMessage: null };
    case 'SET_INFO_MESSAGE':
      return { ...state, infoMessage: action.payload, errorMessage: null, successMessage: null };
    case 'CLEAR_PACKAGES_AND_ROUTE':
      const nextPhaseAfterClear = state.user?.plano_ativo ? AppPhase.PACKAGE_COUNT_SETUP : AppPhase.PLAN_EXPIRED;
      return { ...state, packages: [], optimizedRoute: [], currentStopIndex: 0, totalPackagesEstimate: 0, userLocation: null, manualOriginAddress: null, phase: nextPhaseAfterClear };
    case 'SET_SPEECH_RECOGNITION_STATUS':
        return { ...state, isMicrophoneAvailable: action.payload.available, isSpeechRecognitionSupported: action.payload.supported };
    case 'SET_USER_LOCATION':
        return { ...state, userLocation: action.payload };
    case 'SET_MANUAL_ORIGIN_ADDRESS':
        return { ...state, manualOriginAddress: action.payload };
    case 'SET_OPTIMIZATION_MODE':
        return { ...state, optimizationMode: action.payload };
    case 'SHOW_PLAN_LIMIT_MODAL':
        return { ...state, showPlanLimitModal: action.payload };
    case 'SHOW_UPGRADE_MODAL':
        return { ...state, showUpgradeModal: action.payload };
    case 'SHOW_NOTIFY_ALL_MODAL':
        return { ...state, showNotifyAllModal: action.payload };
    case 'SHOW_CAMERA_MODAL':
        return { ...state, showCameraModal: action.payload };
    case 'SHOW_MANUAL_ORIGIN_MODAL':
        return { ...state, showManualOriginModal: action.payload };
    case 'SET_IS_AUTHENTICATING':
        return { ...state, isAuthenticating: action.payload };
    case 'UPDATE_USER_DELIVERY_COUNTS':
      if (!state.user) return state;
      return {
        ...state,
        user: {
          ...state.user,
          entregas_hoje: action.payload.entregas_hoje,
          entregas_gratis_utilizadas: action.payload.entregas_gratis_utilizadas !== undefined
            ? action.payload.entregas_gratis_utilizadas
            : state.user.entregas_gratis_utilizadas,
        },
      };
    case 'UPDATE_USER_SETTINGS_SUCCESS':
      if (!state.user) return state;
      return {
        ...state,
        user: { ...state.user, ...action.payload }
      };
    case 'SHOW_PASSWORD_RESET_MODAL':
        return { ...state, showPasswordResetModal: action.payload, passwordResetEmailSent: false, errorMessage: null, successMessage: null };
    case 'PASSWORD_RESET_EMAIL_SENT':
        return { ...state, passwordResetEmailSent: action.payload };
    default:
      return state;
  }
};

// Helper function to get the application's root URL and check for file:// protocol
const getAppRootUrl = (dispatch: React.Dispatch<AppAction>): string => {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    const message = "CRITICAL ERROR: A aplicação está sendo servida via protocolo 'file://'. A autenticação e os redirecionamentos de URL exigem um servidor HTTP/HTTPS. Por favor, use um servidor local (ex: Live Server no VS Code ou 'npx serve .') para servir os arquivos do projeto.";
    console.error(message);
    // Dispatch error to UI if context allows, otherwise console error is primary
    if (dispatch) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: message });
    }
    alert(message); // Make it very obvious
    throw new Error(message); 
  }
  
  if (typeof window === 'undefined') { // Should not happen in browser context
    return ''; // Or handle as an error
  }

  const href = window.location.href;
  const hashIndex = href.indexOf('#');
  return hashIndex === -1 ? href : href.substring(0, hashIndex); // URL before hash, or full URL if no hash
};


const AppContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);

useEffect(() => {
  const fetchSessionAndProfile = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.user?.id) {
      try {
        const { id, email, user_metadata } = session.user;

        // Sincroniza o perfil (ou cria) usando função do Supabase
        await invokeSyncUserProfile({
          userId: id,
          email,
          nome: user_metadata?.full_name ?? "Entregador",
        });

        const profile = await getUserProfile(id);

        dispatch({
          type: 'LOGIN_SUCCESS',
          payload: profile,
        });
      } catch (err) {
        console.error("Erro ao carregar sessão:", err);
        dispatch({ type: 'LOGOUT' });
      }
    } else {
      dispatch({ type: 'LOGOUT' });
    }
  };

  fetchSessionAndProfile();

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      dispatch({ type: 'LOGOUT' });
    }
  });

  return () => subscription.unsubscribe();
}, []);


  const fetchUserEntregas = async (userId: string) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const entregas = await getEntregasByUserId(userId);
      // Filter for today's pending/in_rota packages to populate 'packages' or 'optimizedRoute'
      // This logic might need to be more sophisticated based on app flow.
      // For now, let's assume we set all non-delivered as 'packages'
      // FIX: Use English status 'delivered' and 'cancelled'
      const activePackages = entregas.filter(e => e.status !== 'delivered' && e.status !== 'cancelled');
      dispatch({ type: 'SET_PACKAGES', payload: activePackages });

      // If there's an active route (e.g., status 'in_transit'), reconstruct it
      const currentRoutePackages = activePackages
        // FIX: Check for optimized_order on PackageInfo. Use English status 'in_transit'.
        .filter(p => p.status === 'in_transit' && typeof p.optimized_order === 'number')
        // FIX: Ensure mapping to RouteStop with 'order' from 'optimized_order'
        .map(p => ({ ...p, order: p.optimized_order! } as RouteStop))
        .sort((a, b) => a.order - b.order);

      if (currentRoutePackages.length > 0) {
         dispatch({ type: 'SET_OPTIMIZED_ROUTE', payload: currentRoutePackages });
         // Potentially find currentStopIndex if app was closed mid-route
         // FIX: Use English status 'delivered'
         const firstPendingIndex = currentRoutePackages.findIndex(p => p.status !== 'delivered');
         if (firstPendingIndex !== -1 && state.phase === AppPhase.DELIVERY) { // only if currently in delivery phase
            // dispatch({ type: 'SET_CURRENT_STOP_INDEX', payload: firstPendingIndex }); // Needs new action
         }
      }

    } catch (error: any) {
      console.error("Error fetching user entregas:", error.message || JSON.stringify(error));
      dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Erro ao carregar suas entregas.' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  useEffect(() => {
    loadPdfJs();
    loadXlsx();

    const fetchSessionAndProfile = async (sessionUser: any) => { // sessionUser is of type SupabaseUser
        dispatch({ type: 'SET_IS_AUTHENTICATING', payload: true });
        dispatch({ type: 'SET_INFO_MESSAGE', payload: null }); // Clear previous info messages
        try {
            console.log("[Auth] Sessão detectada. Verificando perfil...");
            let profile = await getUserProfile(sessionUser.id);

            if (profile) {
                console.log("[Auth] Perfil encontrado.");
                dispatch({ type: 'SET_INFO_MESSAGE', payload: "Perfil carregado." });
            } else {
                console.log("[Auth] Perfil não encontrado. Tentando criar via Edge Function...");
                dispatch({ type: 'SET_INFO_MESSAGE', payload: 'Criando seu perfil, aguarde...' });
                // Pass user metadata which might contain full_name or other details for 'nome'
                const userMetadataForProfile = {
                    full_name: sessionUser.user_metadata?.full_name,
                    // any other metadata you want to pass to the Edge Function
                };

                const newProfile = await invokeSyncUserProfile(
                    sessionUser.id, 
                    sessionUser.email, 
                    userMetadataForProfile
                );
                
                if (newProfile) {
                    profile = newProfile;
                    console.log("[Auth] Novo perfil criado com sucesso via Edge Function.");
                     dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: "Perfil criado com sucesso!" });
                } else {
                    console.error("[Auth] Falha crítica ao tentar criar perfil via Edge Function: invokeSyncUserProfile retornou null ou erro.");
                    throw new Error("Não foi possível criar o perfil do usuário. Tente novamente mais tarde.");
                }
            }
            
            if (profile) {
                dispatch({ type: 'LOGIN_SUCCESS', payload: profile });
                console.log("[Auth] Login concluído com sucesso.");
                await fetchUserEntregas(profile.id);
            } else {
                console.error("[Auth] Perfil não disponível após tentativa de busca/criação.");
                throw new Error("Falha ao obter ou criar o perfil do usuário. Por favor, contate o suporte.");
            }
        } catch (error: any) {
            console.error("[Auth] Erro durante fetchSessionAndProfile:", error.message || JSON.stringify(error));
            let detailedErrorMessage = `Erro ao carregar dados do usuário: ${error.message || 'Erro desconhecido.'}`;
            if (error.message && error.message.includes("Function not found")) {
                detailedErrorMessage = "Erro crítico: Função de sincronização de perfil não encontrada. Contate o suporte.";
            } else if (error.message && error.message.includes("Failed to fetch")) {
                 detailedErrorMessage = "Erro de rede ao tentar sincronizar perfil. Verifique sua conexão e tente novamente.";
            }
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: detailedErrorMessage });
            try {
                await supabase.auth.signOut();
            } catch (signOutError: any) {
                console.error("[Auth] Erro ao tentar deslogar após falha no perfil:", signOutError.message || JSON.stringify(signOutError));
            }
            dispatch({ type: 'LOGOUT' });
        } finally {
            console.log(`[Auth] Executando bloco finally de fetchSessionAndProfile para garantir que isAuthenticating seja false (ID: ${sessionUser.id.substring(0,8)}).`);
            // Clear info message after a delay if it's about profile creation
            if (state.infoMessage === 'Criando seu perfil, aguarde...' || state.successMessage === "Perfil criado com sucesso!") {
                setTimeout(() => dispatch({ type: 'SET_INFO_MESSAGE', payload: null }), 3000);
                setTimeout(() => dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: null }), 3000);
            }
            dispatch({ type: 'SET_IS_AUTHENTICATING', payload: false });
        }
    };
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && session.user) {
        console.log(`[Auth] Sessão ativa encontrada ao iniciar (ID: ${session.user.id.substring(0,8)}).`);
        fetchSessionAndProfile(session.user);
      } else {
        console.log("[Auth] Nenhuma sessão ativa ao iniciar.");
        dispatch({ type: 'SET_IS_AUTHENTICATING', payload: false });
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(`[Auth] Evento: ${event}` + (session ? ` (ID: ${session.user.id.substring(0,8)})` : ''));
      if (event === 'INITIAL_SESSION' && session && session.user) {
         // This case might be redundant if getSession() already handled it.
         // However, it's good for ensuring profile sync if getSession was quick and onAuthStateChange fires later.
         // fetchSessionAndProfile(session.user);
      } else if (event === 'SIGNED_IN' && session && session.user) {
        console.log(`[Auth] Evento SIGNED_IN. Chamando fetchSessionAndProfile (ID: ${session.user.id.substring(0,8)}).`);
        fetchSessionAndProfile(session.user);
      } else if (event === 'SIGNED_OUT') {
        console.log("[Auth] Evento SIGNED_OUT.");
        dispatch({ type: 'LOGOUT' });
      } else if (event === 'USER_UPDATED' && session && session.user) {
         console.log("[Auth] Evento USER_UPDATED. Atualizando perfil local.");
         // Typically just re-fetch profile to get latest email, etc.
         // The full fetchSessionAndProfile might be too much if only auth user object changed.
         const updatedAuthUser = session.user;
         const currentLocalUser = state.user;
         if (currentLocalUser && (updatedAuthUser.email !== currentLocalUser.email)) {
            // If email changed, a more full sync might be needed.
            fetchSessionAndProfile(updatedAuthUser);
         } else if (currentLocalUser) {
            // Just update the email or relevant parts if they changed in auth.users but not usuarios_rotaspeed
            const refreshedProfile = await getUserProfile(updatedAuthUser.id);
            if(refreshedProfile) dispatch({ type: 'LOGIN_SUCCESS', payload: refreshedProfile });
         }

      } else if (event === 'PASSWORD_RECOVERY' && session) {
        console.log("[Auth] Evento PASSWORD_RECOVERY. Usuário pode redefinir senha.");
        dispatch({ type: 'SET_IS_AUTHENTICATING', payload: false }); 
      } else if (event === 'TOKEN_REFRESHED' && session && session.user) {
        console.log("[Auth] Evento TOKEN_REFRESHED.");
        // If user state is missing but session exists, try to fetch profile
        if (!state.user) {
            // fetchSessionAndProfile(session.user); // This could be aggressive, monitor if needed
        }
      }
    });

    return () => {
      authListener?.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Ensure dispatch is stable or add to deps if necessary, though usually not. state.user check inside to avoid loops


  useEffect(() => {
    if (state.user && !state.isAuthenticating) { // Ensure user is loaded and not in auth process
      const interval = setInterval(async () => {
        if (document.visibilityState === 'visible' && state.user) { 
          try {
            const profile = await getUserProfile(state.user.id);
            if (profile) {
              // Check for meaningful changes before dispatching to avoid unnecessary re-renders
              const userChanged = profile.entregas_hoje !== state.user?.entregas_hoje ||
                                  profile.plano_ativo !== state.user?.plano_ativo ||
                                  profile.entregas_gratis_utilizadas !== state.user?.entregas_gratis_utilizadas ||
                                  profile.plano_nome !== state.user?.plano_nome ||
                                  profile.nome !== state.user?.nome ||
                                  profile.driver_name !== state.user?.driver_name ||
                                  profile.driver_phone !== state.user?.driver_phone ||
                                  profile.navigation_preference !== state.user?.navigation_preference ||
                                  profile.notification_sender_preference !== state.user?.notification_sender_preference;

              if (userChanged) {
                dispatch({ type: 'LOGIN_SUCCESS', payload: profile }); // This also clears packages and route locally.
                await fetchUserEntregas(profile.id);
              }
            }
          } catch (error: any) {
            console.error("Error periodically refreshing user profile:", error.message || JSON.stringify(error));
          }
        }
      }, 5 * 60 * 1000); 

      return () => clearInterval(interval);
    }
  }, [state.user, state.isAuthenticating, dispatch]); // Added dispatch to dependencies


  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
};

const useSharedState = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useSharedState must be used within an AppContextProvider');
  return context;
};

// --- Page Components ---
const LoginPage: React.FC = () => {
  const { dispatch, state } = useSharedState();
  // const navigate = useNavigate(); // useNavigate is not used currently
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [resetEmail, setResetEmail] = useState('');


  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({ type: 'SET_IS_AUTHENTICATING', payload: true });
    dispatch({ type: 'SET_ERROR_MESSAGE', payload: null });
    dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: null });
    dispatch({ type: 'SET_INFO_MESSAGE', payload: null });


    try {
      // Check protocol before auth attempt
      getAppRootUrl(dispatch);

      if (isSigningUp) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        if (signUpData.user) {
           // User will be signed in, onAuthStateChange will trigger profile creation/sync
           dispatch({ type: 'SET_INFO_MESSAGE', payload: 'Cadastro realizado! Verifique seu e-mail para confirmação (se aplicável). Finalizando login...' });
        } else if (signUpData.session && !signUpData.user) { // Email confirmation required
            dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Cadastro realizado! Verifique seu e-mail para confirmação.' });
            dispatch({ type: 'SET_IS_AUTHENTICATING', payload: false });
        }
         else {
             dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Falha no cadastro. Usuário não retornado e sem sessão de confirmação.' });
             dispatch({ type: 'SET_IS_AUTHENTICATING', payload: false });
        }
      } else {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        if (!signInData.user) {
             dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Falha no login. Usuário não retornado.' });
             dispatch({ type: 'SET_IS_AUTHENTICATING', payload: false });
        }
        // onAuthStateChange with SIGNED_IN will trigger fetchSessionAndProfile
      }
    } catch (error: any) {
      let message = error.message || 'Ocorreu um erro.';
      if (error.message.includes("Invalid login credentials")) message = "E-mail ou senha inválidos.";
      if (error.message.includes("User already registered")) message = "Este e-mail já está cadastrado. Tente fazer login.";
      if (error.message.includes("Password should be at least 6 characters")) message = "A senha deve ter pelo menos 6 caracteres.";
      if (error.message.includes("Email rate limit exceeded")) message = "Muitas tentativas de cadastro. Tente novamente mais tarde.";
      // If it's the specific file:// protocol error, it might have already been dispatched by getAppRootUrl
      if (!state.errorMessage || !state.errorMessage.includes("protocolo 'file://'")) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: message });
      }
      dispatch({ type: 'SET_IS_AUTHENTICATING', payload: false });
    }
  };

  const handleGoogleLogin = async () => {
    dispatch({ type: 'SET_IS_AUTHENTICATING', payload: true });
    dispatch({ type: 'SET_ERROR_MESSAGE', payload: null });
    dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: null });
    dispatch({ type: 'SET_INFO_MESSAGE', payload: null });
    try {
        const appRootUrl = getAppRootUrl(dispatch);
        
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: appRootUrl, 
            },
        });
        if (error) {
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Erro com login Google: ${error.message}` });
            dispatch({ type: 'SET_IS_AUTHENTICATING', payload: false });
        }
        // onAuthStateChange will handle the rest
    } catch (error: any) {
         if (!state.errorMessage || !state.errorMessage.includes("protocolo 'file://'")) {
           dispatch({ type: 'SET_ERROR_MESSAGE', payload: error.message || "Erro ao iniciar login com Google." });
        }
        dispatch({ type: 'SET_IS_AUTHENTICATING', payload: false });
    }
  };

  const handlePasswordResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Por favor, insira seu e-mail.' });
        return;
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR_MESSAGE', payload: null });
    dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: null });
    
    try {
        const appRootUrl = getAppRootUrl(dispatch);
        const redirectTo = `${appRootUrl}#/reset-password`; 
        
        const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
          redirectTo: redirectTo, 
        });
        dispatch({ type: 'SET_LOADING', payload: false });
        if (error) {
          dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Erro ao enviar e-mail de recuperação: ${error.message}` });
          dispatch({ type: 'PASSWORD_RESET_EMAIL_SENT', payload: false });
        } else {
          dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Se o e-mail existir, um link para redefinir sua senha foi enviado.' });
          dispatch({ type: 'PASSWORD_RESET_EMAIL_SENT', payload: true });
        }
    } catch (error: any) {
        if (!state.errorMessage || !state.errorMessage.includes("protocolo 'file://'")) {
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: error.message || "Erro ao solicitar redefinição de senha." });
        }
        dispatch({ type: 'SET_LOADING', payload: false });
        dispatch({ type: 'PASSWORD_RESET_EMAIL_SENT', payload: false });
    }
  };
  
  if (state.isAuthenticating && !state.user) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-700 p-4">
            <Spinner size="lg" color="border-white"/>
            <p className="text-white mt-4">{state.infoMessage || 'Verificando sessão...'}</p>
        </div>
    );
  }


  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-700 p-4 font-sans">
        <div className="text-center mb-8">
            <PackageIcon className="w-20 h-20 text-white mx-auto mb-2"/>
            <h1 className="text-5xl font-bold text-white">RotaSpeed</h1>
            <p className="text-blue-200 text-lg">Otimize suas entregas diárias.</p>
        </div>
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm space-y-6">
        <h2 className="text-2xl font-semibold text-center text-gray-700">{isSigningUp ? 'Criar Conta' : 'Login do Entregador'}</h2>
        {state.errorMessage && <Alert type="error" message={state.errorMessage} onClose={() => dispatch({ type: 'SET_ERROR_MESSAGE', payload: null })} />}
        {state.successMessage && <Alert type="success" message={state.successMessage} onClose={() => dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: null })} />}
        {state.infoMessage && <Alert type="info" message={state.infoMessage} onClose={() => dispatch({ type: 'SET_INFO_MESSAGE', payload: null })} />}
        
        <form onSubmit={handleAuth} className="space-y-4">
            <Input id="email" type="email" label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} icon={<UserIcon />} placeholder="seu@email.com" required />
            <Input id="password" type="password" label="Senha" value={password} onChange={(e) => setPassword(e.target.value)} icon={<LockClosedIcon />} placeholder="******" required />
            <Button type="submit" variant="primary" size="lg" className="w-full bg-blue-600 hover:bg-blue-700" isLoading={state.isAuthenticating && !state.user && !state.showPasswordResetModal}>
              {isSigningUp ? 'Cadastrar' : 'Entrar'}
            </Button>
        </form>
        <Button
            onClick={handleGoogleLogin}
            variant="secondary"
            size="lg"
            className="w-full border border-gray-300 hover:bg-gray-50"
            // isLoading={state.isAuthenticating && !state.user} // Only show loading if specifically authenticating for Google.
        >
            <GoogleIcon className="w-5 h-5 mr-2" />
            Entrar com Google
        </Button>
        <div className="text-center">
            <Button type="button" variant="ghost" size="sm" onClick={() => dispatch({ type: 'SHOW_PASSWORD_RESET_MODAL', payload: true })}>
                Esqueci minha senha
            </Button>
        </div>
        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => {setIsSigningUp(!isSigningUp); dispatch({ type: 'SET_ERROR_MESSAGE', payload: null }); dispatch({type: 'SET_SUCCESS_MESSAGE', payload: null}); dispatch({type: 'SET_INFO_MESSAGE', payload: null});}}>
          {isSigningUp ? 'Já tem uma conta? Fazer Login' : 'Não tem uma conta? Cadastre-se'}
        </Button>
      </div>
       <p className="text-center text-xs text-blue-200 mt-4">
        Ao se cadastrar, você ganha 10 entregas grátis!
      </p>

      <Modal
        isOpen={state.showPasswordResetModal || false}
        onClose={() => dispatch({ type: 'SHOW_PASSWORD_RESET_MODAL', payload: false })}
        title="Redefinir Senha"
      >
        {!state.passwordResetEmailSent ? (
            <form onSubmit={handlePasswordResetRequest} className="space-y-4">
            <p className="text-sm text-gray-600">Digite seu e-mail para enviarmos um link de redefinição de senha.</p>
            <Input id="reset-email" type="email" label="Seu E-mail" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} icon={<UserIcon />} placeholder="seu@email.com" required />
            <Button type="submit" variant="primary" className="w-full" isLoading={state.isLoading}>Enviar Link</Button>
            </form>
        ) : (
            <p className="text-sm text-green-600">Se o e-mail estiver cadastrado, um link para redefinir sua senha foi enviado. Verifique sua caixa de entrada e spam.</p>
        )}
         {/* Error messages within modal are handled by the global error message in AppShell or specific error display here if needed */}
         {/* {state.errorMessage && <Alert type="error" message={state.errorMessage} onClose={() => dispatch({ type: 'SET_ERROR_MESSAGE', payload: null })} />} */}
      </Modal>
    </div>
  );
};


const ResetPasswordPage: React.FC = () => {
    const { dispatch } = useSharedState();
    const navigate = useNavigate();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handlePasswordUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (newPassword !== confirmPassword) {
            setError("As senhas não coincidem.");
            return;
        }
        if (newPassword.length < 6) {
            setError("A nova senha deve ter pelo menos 6 caracteres.");
            return;
        }

        setIsLoading(true);
        try {
            const { data, error: updateError } = await supabase.auth.updateUser({ password: newPassword });
            if (updateError) throw updateError;
            
            setSuccess("Senha atualizada com sucesso! Você pode fazer login com sua nova senha.");
            dispatch({type: 'SET_SUCCESS_MESSAGE', payload: "Senha atualizada! Faça login."}); 
            setTimeout(() => navigate('/'), 3000);

        } catch (err: any) {
            console.error("Password update error:", err.message || JSON.stringify(err));
            let userMessage = err.message || "Erro ao atualizar a senha.";
            if (err.message?.includes("User not found") || err.message?.includes("Invalid token") || err.message?.includes("expired")) {
                 userMessage = "Link de recuperação inválido ou expirado. Por favor, solicite um novo link.";
            } else if (err.message?.includes("same password")) {
                 userMessage = "A nova senha não pode ser igual à senha antiga.";
            }
            setError(userMessage);
        } finally {
            setIsLoading(false);
        }
    };

    return (
         <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 p-4">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm space-y-6">
                <h2 className="text-2xl font-semibold text-center text-gray-700">Redefinir sua Senha</h2>
                {!error && !success && (
                    <form onSubmit={handlePasswordUpdate} className="space-y-4">
                        <Input
                            id="new-password"
                            type="password"
                            label="Nova Senha"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            placeholder="Nova senha (mín. 6 caracteres)"
                        />
                        <Input
                            id="confirm-password"
                            type="password"
                            label="Confirmar Nova Senha"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            placeholder="Confirme a nova senha"
                        />
                        <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
                            Atualizar Senha
                        </Button>
                    </form>
                )}
                {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
                {success && <Alert type="success" message={success} />}
                 <div className="text-center mt-4">
                    <Link to="/" className="text-sm text-blue-600 hover:underline">Voltar para Login</Link>
                </div>
            </div>
        </div>
    );
};


const PackageSetupPage: React.FC = () => {
  const { state, dispatch } = useSharedState();
  const navigate = useNavigate();
  const [count, setCount] = useState<string>('');

  const userPlanLimit = state.user?.plano_nome === 'Grátis'
    ? Math.max(0, (state.user?.entregas_dia_max || 0) - (state.user?.entregas_gratis_utilizadas || 0))
    : (state.user && state.user.entregas_dia_max > state.user.entregas_hoje) 
        ? state.user.entregas_dia_max - state.user.entregas_hoje 
        : 0;


  const actualLimitName = state.user?.plano_nome === 'Grátis' ? "entregas grátis restantes" : "entregas permitidas hoje no plano";
  const dailyLimitForPlan = state.user?.entregas_dia_max || 0;


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numCount = parseInt(count, 10);

    if (!state.user) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Usuário não autenticado.' });
        navigate('/');
        return;
    }
    if (!state.user.plano_ativo) {
        dispatch({ type: 'SET_PHASE', payload: AppPhase.PLAN_EXPIRED });
        dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: true });
        return;
    }

    if (numCount > 0) {
      if (state.user.plano_nome === 'Grátis') {
        if (state.user.entregas_gratis_utilizadas >= dailyLimitForPlan) {
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Você já utilizou suas ${dailyLimitForPlan} entregas grátis.` });
            dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: true });
            return;
        }
        if (numCount > userPlanLimit) {
             dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Você tem ${userPlanLimit} ${actualLimitName}. Você tentou adicionar ${numCount}.` });
             dispatch({ type: 'SHOW_PLAN_LIMIT_MODAL', payload: true }); 
             return;
        }
      } else { // Paid plan
        if (state.user.entregas_hoje >= dailyLimitForPlan) {
             dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Você atingiu seu limite de ${dailyLimitForPlan} entregas diárias.` });
             dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: true }); 
             return;
        }
        const remainingToday = dailyLimitForPlan - state.user.entregas_hoje;
        if (numCount > remainingToday) {
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Seu plano permite mais ${remainingToday} entregas hoje. Você tentou adicionar ${numCount}.` });
            dispatch({ type: 'SHOW_PLAN_LIMIT_MODAL', payload: true }); 
            return;
        }
      }
      dispatch({ type: 'SET_TOTAL_PACKAGES_ESTIMATE', payload: numCount });
      navigate('/app/package-input');

    } else {
      dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Por favor, insira um número válido de pacotes.' });
    }
  };
  
  const getPlanLimitInfo = () => {
    if (!state.user) return "Carregando informações do plano...";
    if (state.user.plano_nome === 'Grátis') {
        const remainingFree = Math.max(0, dailyLimitForPlan - state.user.entregas_gratis_utilizadas);
        if (remainingFree === 0) return `Você utilizou todas as suas ${dailyLimitForPlan} entregas grátis.`;
        return `Você tem ${remainingFree} de ${dailyLimitForPlan} entregas grátis restantes.`;
    }
    const remainingToday = Math.max(0, dailyLimitForPlan - state.user.entregas_hoje);
    return `Seu plano (${state.user.plano_nome}) permite ${dailyLimitForPlan} entregas/dia. Você tem ${remainingToday} restantes para hoje.`;
  };


  return (
    <AppShell title="Configuração de Entregas" showLogout>
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
          <InformationCircleIcon className="w-4 h-4 inline mr-1" /> {getPlanLimitInfo()}
      </div>
      {state.user && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-md text-sm">
            <p>Usuário: <span className="font-semibold">{state.user.nome || state.user.driver_name || state.user.email}</span></p>
            <p>Plano Atual: <span className="font-semibold">{state.user.plano_nome}</span></p>
            <p>Entregas Hoje: <span className="font-semibold">{state.user.entregas_hoje} / {state.user.entregas_dia_max}</span></p>
            <p>Créditos de Voz: <span className="font-semibold">{state.user.saldo_creditos}</span></p>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-6">
        <Input
          id="package-count"
          type="number"
          label="Quantos pacotes você tem para hoje?"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder={`Ex: ${userPlanLimit > 0 ? userPlanLimit : 5}`}
          min="1"
          required
          icon={<PackageIcon className="text-gray-400"/>}
        />
        <Button type="submit" variant="primary" size="lg" className="w-full">
          Continuar para Adicionar Pacotes
        </Button>
      </form>
      <Modal
        isOpen={state.showPlanLimitModal}
        onClose={() => dispatch({ type: 'SHOW_PLAN_LIMIT_MODAL', payload: false })}
        title="Limite de Entregas"
      >
        <p className="text-gray-700 mb-4">
          {state.errorMessage || `A quantidade de pacotes informada (${count}) excede seu limite atual de ${userPlanLimit} ${actualLimitName}.`}
        </p>
        <p className="text-gray-700 mb-4">
          Para aumentar seu limite ou continuar usando o serviço, por favor, verifique nossos planos.
        </p>
        <Button
            onClick={() => {
                navigate('/app/subscription-info');
                dispatch({ type: 'SHOW_PLAN_LIMIT_MODAL', payload: false });
            }}
            variant="primary"
            className="w-full"
        >
          Ver Planos
        </Button>
      </Modal>
       <Modal
        isOpen={state.showUpgradeModal}
        onClose={() => dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: false })}
        title={state.user?.plano_ativo === false ? "Plano Inativo" : "Limite Atingido"}
      >
        <p className="text-gray-700 mb-4">
          {state.user?.plano_ativo === false ? "Seu plano está atualmente inativo." :
           state.user?.plano_nome === 'Grátis' ? `Você utilizou todas as suas ${dailyLimitForPlan} entregas grátis.` :
           `Você atingiu seu limite diário de ${dailyLimitForPlan} entregas para o plano ${state.user?.plano_nome}.`
          }
        </p>
        <p className="text-gray-700 mb-4">
          Para continuar utilizando o RotaSpeed e otimizar mais entregas, por favor, reative seu plano ou faça um upgrade.
        </p>
        <Button
            onClick={() => {
                navigate('/app/subscription-info');
                dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: false });
            }}
            variant="primary"
            className="w-full"
        >
          Ver Planos de Assinatura
        </Button>
      </Modal>
    </AppShell>
  );
};

const PackageInputPage: React.FC = () => {
  const { state, dispatch } = useSharedState();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<InputType>(InputType.TEXT);
  const [textInput, setTextInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [tempManualOrigin, setTempManualOrigin] = useState('');
  const currentRouteIdRef = useRef<string | null>(null); // To group packages of the same optimization run


  const { transcript, startListening, stopListening, isListening, error: speechError, resetTranscript, isSupported: speechSupported, isMicrophoneAvailable: micAvailableHook } = useSpeechRecognition();

  useEffect(() => {
    dispatch({ type: 'SET_SPEECH_RECOGNITION_STATUS', payload: { available: micAvailableHook, supported: speechSupported } });
  }, [micAvailableHook, speechSupported, dispatch]);

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = null;
    }
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (state.showCameraModal && cameraStream && cameraVideoRef.current) {
      if (cameraVideoRef.current.srcObject !== cameraStream) {
        cameraVideoRef.current.srcObject = cameraStream;
        cameraVideoRef.current.play().catch(playError => {
          console.error("Error playing camera video stream:", playError);
        });
      }
    }
  }, [state.showCameraModal, cameraStream]);

  const handleAddParsedPackagesToStateAndDb = async (parsedAddresses: ParsedAddressFromAI[], inputType: InputType, originalInput?: string) => {
    if (!state.user) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Usuário não autenticado.' });
        return;
    }

    // FIX: Use EntregaData with DB status 'pendente'
    const newPackagesToSave: EntregaData[] = parsedAddresses.map((addr, index) => ({
        user_id: state.user!.id,
        fullAddress: addr.fullAddress || (addr.street ? `${addr.street}, ${addr.number || ''}${addr.bairro ? ', ' + addr.bairro : ''} - ${addr.cep || ''}, ${addr.city || ''} - ${addr.state || ''}`.replace(/ ,/g, '').replace(/ - $/, '').trim() : 'Endereço não reconhecido'),
        street: addr.street,
        number: addr.number,
        bairro: addr.bairro,
        complemento: addr.complemento,
        cep: addr.cep,
        city: addr.city,
        state: addr.state,
        recipientName: addr.recipientName,
        telefone: addr.telefone,
        status: 'pendente' as EntregaDbRecord['status'], // DB status
        originalInput: originalInput || `Entrada por ${inputType}`,
        inputType: inputType,
        // route_id, optimized_order will be set after optimization
    }));

    try {
        // addMultipleEntregas returns PackageInfo[] with mapped (English) statuses
        const savedPackages = await addMultipleEntregas(newPackagesToSave);
        if (savedPackages.length > 0) {
            dispatch({ type: 'ADD_PACKAGES', payload: savedPackages }); // Add to local state (with English status)
            dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: `${savedPackages.length} endereço(s) adicionado(s) com sucesso.` });
            setTextInput('');
            resetTranscript();
            if (fileInputRef.current) fileInputRef.current.value = "";
        } else if (newPackagesToSave.length > 0) {
            // This case might happen if addMultipleEntregas returns empty on non-error, which it shouldn't
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: "Endereços processados, mas falha ao salvar. Tente novamente." });
        }
    } catch (dbError: any) {
        console.error("Error saving packages to DB:", dbError.message || JSON.stringify(dbError));
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Erro ao salvar endereços: ${dbError.message}` });
        // Optionally add them to local state with an error status if needed for UI feedback
    }
  };


  const handleProcessInput = async (type: InputType, data: string | File, fileName?: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR_MESSAGE', payload: null });
    dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: null });
    dispatch({ type: 'SET_INFO_MESSAGE', payload: null });

    if (!state.user || !state.user.plano_ativo) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Seu plano está inativo. Não é possível adicionar pacotes.' });
        dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: true });
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
    }
    
    // Simplistic check for total packages to be added vs estimate for UI info
    // This doesn't block, actual block is on route optimization
    const countFromData = (typeof data === 'string' && type === InputType.TEXT) ? (data.split('\n').length) : 1;
    const currentLocalPackagesCount = state.packages.length; // Packages already processed and in local state (and DB)
    const estimatedTotalAfterAdding = currentLocalPackagesCount + countFromData;

     if (estimatedTotalAfterAdding > state.totalPackagesEstimate && state.totalPackagesEstimate > 0) {
        dispatch({ type: 'SET_INFO_MESSAGE', payload: `Atenção: Você está adicionando mais pacotes (${estimatedTotalAfterAdding}) do que o estimado inicialmente (${state.totalPackagesEstimate}).` });
    }

    let parsedAddresses: ParsedAddressFromAI[] = [];
    let originalInputTextForLog = fileName || (data instanceof File ? data.name : 'Entrada por ' + type);

    try {
      let textToParse = '';
      if (type === InputType.TEXT || type === InputType.VOICE) {
        textToParse = data as string;
        if (!textToParse.trim()) {
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Nenhum texto fornecido.' });
            dispatch({ type: 'SET_LOADING', payload: false });
            return;
        }
        parsedAddresses = await parseAddressFromTextWithGemini(textToParse);
        originalInputTextForLog = textToParse;
      } else if ((type === InputType.PHOTO || type === InputType.CAMERA) && typeof data === 'string' && data.startsWith('data:image')) {
        const mimeType = data.substring(data.indexOf(':') + 1, data.indexOf(';'));
        originalInputTextForLog = `Imagem Capturada`;
        if(type === InputType.PHOTO && fileName) originalInputTextForLog = `Imagem: ${fileName}`;
        parsedAddresses = await parseAddressFromImageWithGemini(data, mimeType);
      } else if (type === InputType.PHOTO && data instanceof File) {
        const base64 = await convertImageToBase64(data);
        originalInputTextForLog = `Imagem: ${data.name}`;
        parsedAddresses = await parseAddressFromImageWithGemini(base64, data.type);
      } else if (type === InputType.FILE_PDF && data instanceof File) {
        textToParse = await extractTextFromPdf(data);
        originalInputTextForLog = `PDF: ${data.name}\nConteúdo: ${textToParse.substring(0,200)}...`;
        parsedAddresses = await parseAddressFromTextWithGemini(textToParse);
      } else if (type === InputType.FILE_SHEET && data instanceof File) {
        textToParse = await extractTextFromSheet(data);
        originalInputTextForLog = `Planilha: ${data.name}\nConteúdo: ${textToParse.substring(0,200)}...`;
        parsedAddresses = await parseAddressFromTextWithGemini(textToParse);
      }

      if (parsedAddresses.length === 0) {
        const specificErrorMessage = (type === InputType.PHOTO || type === InputType.CAMERA || type === InputType.VOICE)
            ? "Não foi possível entender os dados enviados. Por favor, envie novamente com mais nitidez ou use outro modo."
            : "Nenhum endereço pôde ser extraído ou o formato não foi reconhecido.";
        dispatch({type: 'SET_ERROR_MESSAGE', payload: specificErrorMessage});
      } else {
        await handleAddParsedPackagesToStateAndDb(parsedAddresses, type, originalInputTextForLog);
      }
    } catch (err: any) {
      console.error("Error processing input:", err.message || JSON.stringify(err));
      let errorMessage = `Erro ao processar entrada: ${err.message || 'Erro desconhecido'}`;
      if (err.message && err.message.includes("backend proxy is not configured")) {
        errorMessage = "Erro de configuração: O serviço de processamento de endereços não está configurado. Contate o suporte.";
      }
      dispatch({ type: 'SET_ERROR_MESSAGE', payload: errorMessage });
       // Do not add error packages to DB, only local state if desired for UI, but current setup avoids this.
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const handleVoiceInput = () => {
    if(isListening) {
        stopListening();
    } else {
        startListening();
    }
  };

  useEffect(() => {
    if (transcript && !isListening && activeTab === InputType.VOICE) {
      handleProcessInput(InputType.VOICE, transcript, "Transcrição de voz");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, isListening, activeTab]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      let type: InputType;
      if (file.type.startsWith('image/')) type = InputType.PHOTO;
      else if (file.type === 'application/pdf') type = InputType.FILE_PDF;
      else if (['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(file.type)) type = InputType.FILE_SHEET;
      else {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Tipo de arquivo não suportado.' });
        return;
      }
      handleProcessInput(type, file, file.name);
    }
  };

  const handleOpenCamera = async () => {
    dispatch({ type: 'SET_ERROR_MESSAGE', payload: null });
    dispatch({ type: 'SET_INFO_MESSAGE', payload: null });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      dispatch({ type: 'SET_ERROR_MESSAGE', payload: "API da câmera não suportada neste navegador." });
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (errOuter: any) {
      console.warn("Could not get environment camera:", errOuter.name, errOuter.message);
      try {
        dispatch({ type: 'SET_INFO_MESSAGE', payload: "Câmera traseira não disponível/acessível. Tentando câmera padrão/frontal..." });
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (errInner: any) {
        console.error("Error accessing any camera:", errInner.name, errInner.message);
        let errorMessage = "Não foi possível acessar a câmera. Verifique as permissões e se não está em uso por outro app.";
        if (errInner.name === 'NotAllowedError') {
            errorMessage = "Permissão para acessar a câmera foi negada. Por favor, habilite nas configurações do seu navegador.";
        } else if (errInner.name === 'NotFoundError') {
            errorMessage = "Nenhuma câmera encontrada no dispositivo.";
        } else if (errInner.name === 'NotReadableError' || errInner.name === 'TrackStartError' || errInner.name === 'OverconstrainedError' || errInner.name === 'AbortError') {
            errorMessage = `A câmera foi encontrada, mas não pôde ser iniciada (Erro: ${errInner.name}). Pode estar em uso, ser incompatível ou haver um problema de hardware/driver.`;
        }
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: errorMessage });
        stopCamera();
        return;
      }
    }

    if (stream) {
      setCameraStream(stream);
      dispatch({ type: 'SHOW_CAMERA_MODAL', payload: true });
    } else {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: "Falha ao obter o stream da câmera por um motivo desconhecido." });
        stopCamera();
    }
  };

  const handleCapturePhoto = () => {
    if (cameraVideoRef.current && cameraCanvasRef.current && cameraStream) {
      const video = cameraVideoRef.current;
      const canvas = cameraCanvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        handleProcessInput(InputType.CAMERA, dataUrl, "Foto da Câmera");
      }
      stopCamera();
      dispatch({ type: 'SHOW_CAMERA_MODAL', payload: false });
    }
  };


  const TabButton: React.FC<{ type: InputType; label: string; icon: React.ReactNode, onClick?: () => void }> = ({ type, label, icon, onClick }) => (
    <button
      onClick={onClick || (() => setActiveTab(type))}
      className={`flex-1 p-3 text-sm font-medium rounded-t-lg flex items-center justify-center space-x-2 focus:outline-none transition-colors duration-150
        ${activeTab === type && type !== InputType.CAMERA ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const handleRemovePackage = async (id: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
        await deleteEntrega(id);
        dispatch({ type: 'REMOVE_PACKAGE', payload: id }); // Remove from local state
        dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Pacote removido com sucesso.' });
    } catch (error: any) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Erro ao remover pacote: ${error.message}` });
    }
    dispatch({ type: 'SET_LOADING', payload: false });
  };

  const optimizationOptions = [
    { value: 'auto' as const, label: 'Automática (IA)', icon: <ArrowPathIcon className="w-4 h-4" /> },
    { value: 'manual' as const, label: 'Manual', icon: <Bars3Icon className="w-4 h-4" /> },
  ];

  const proceedToOptimization = async (location: UserCoordinates | null, originAddress: string | null) => {
    if (!state.user) return; 
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      // FIX: Use English status 'pending' for filtering
      const validPackages = state.packages.filter(p => p.status === 'pending' && p.fullAddress !== 'Endereço não reconhecido');
      if (validPackages.length === 0) {
          dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Nenhum pacote pendente válido para otimizar.' });
          dispatch({ type: 'SET_LOADING', payload: false });
          return;
      }
      
      const optimizedOrderFromAI = await optimizeRouteWithGemini(validPackages, location, originAddress);
      
      currentRouteIdRef.current = `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const routeStops: RouteStop[] = [];
      // FIX: Updates for DB should use DB status 'em_rota'
      const updatesForDb: Array<{ id: string; optimized_order: number; route_id: string; status: EntregaDbRecord['status']}> = [];

      optimizedOrderFromAI.forEach(item => {
          const originalPackage = validPackages.find(p => p.id === item.id);
          if (originalPackage) {
              const routeStop: RouteStop = {
                  ...originalPackage,
                  order: item.order,
                  // FIX: Use English status 'in_transit' for local state RouteStop
                  status: 'in_transit', 
                  route_id: currentRouteIdRef.current
              };
              routeStops.push(routeStop);
              // FIX: Use DB status 'em_rota' for DB update
              updatesForDb.push({ id: item.id, optimized_order: item.order, route_id: currentRouteIdRef.current!, status: 'em_rota' });
          }
      });
      
      // Update packages in DB with optimized order and route_id
      await updateMultipleEntregasOptimization(updatesForDb);

      // Update user's delivery counts in Supabase
      const numPackagesInRoute = routeStops.length;
      let newEntregasHoje = state.user.entregas_hoje;
      let newEntregasGratisUtilizadas = state.user.entregas_gratis_utilizadas;

      if (state.user.plano_nome === 'Grátis') {
        newEntregasGratisUtilizadas = Math.min(state.user.entregas_dia_max, state.user.entregas_gratis_utilizadas + numPackagesInRoute);
      }
      newEntregasHoje += numPackagesInRoute;
      
      const { error: updateCountError } = await supabase
        .from('usuarios_rotaspeed')
        .update({
          entregas_hoje: newEntregasHoje,
          entregas_gratis_utilizadas: newEntregasGratisUtilizadas,
        })
        .eq('id', state.user.id);

      if (updateCountError) {
        console.error("Error updating delivery counts:", updateCountError.message || JSON.stringify(updateCountError));
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Erro ao atualizar contagem de entregas. A rota foi otimizada, mas o contador pode estar incorreto.' });
      } else {
         dispatch({ type: 'UPDATE_USER_DELIVERY_COUNTS', payload: { entregas_hoje: newEntregasHoje, entregas_gratis_utilizadas: newEntregasGratisUtilizadas } });
      }

      dispatch({ type: 'SET_OPTIMIZED_ROUTE', payload: routeStops });
      // SET_OPTIMIZED_ROUTE action handles navigation based on plan status

    } catch (err: any) {
      console.error("Optimization error:", err.message || JSON.stringify(err));
      let errorMessage = `Erro ao otimizar rota: ${err.message || 'Verifique sua conexão ou tente novamente.'}`;
      if (err.message && err.message.includes("backend proxy is not configured")) {
        errorMessage = "Erro de configuração: O serviço de otimização de rotas não está configurado. Contate o suporte.";
      }
      dispatch({type: 'SET_ERROR_MESSAGE', payload: errorMessage});
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
      dispatch({ type: 'SET_FETCHING_LOCATION', payload: false });
    }
  };

  const handleConfirmAndOptimize = () => {
    if (!state.user) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Sessão expirada. Faça login novamente.' });
        navigate('/');
        return;
    }
    if (!state.user.plano_ativo) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Seu plano está inativo.' });
        dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: true });
        return;
    }

    // FIX: Use English status 'pending' for filtering
    const validPackagesCount = state.packages.filter(p => p.status === 'pending').length;
    if (validPackagesCount === 0) {
      dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Adicione pelo menos um pacote válido e pendente para otimizar a rota.' });
      return;
    }
    
    if (state.user.plano_nome === 'Grátis') {
        if (state.user.entregas_gratis_utilizadas + validPackagesCount > state.user.entregas_dia_max) {
            const canAdd = state.user.entregas_dia_max - state.user.entregas_gratis_utilizadas;
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Você só pode adicionar mais ${canAdd > 0 ? canAdd : 0} entregas grátis. Você tentou rotar ${validPackagesCount}.` });
            dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: true });
            return;
        }
    } else { // Paid plan
        if (state.user.entregas_hoje + validPackagesCount > state.user.entregas_dia_max) {
            const canAdd = state.user.entregas_dia_max - state.user.entregas_hoje;
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Seu plano permite mais ${canAdd > 0 ? canAdd : 0} entregas hoje. Você tentou rotar ${validPackagesCount}.` });
            dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: true });
            return;
        }
    }

    if (state.optimizationMode === 'auto') {
      dispatch({ type: 'SET_FETCHING_LOCATION', payload: true });
      dispatch({ type: 'SET_ERROR_MESSAGE', payload: null });
      dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: null });
      dispatch({ type: 'SET_INFO_MESSAGE', payload: null });
      dispatch({ type: 'SET_MANUAL_ORIGIN_ADDRESS', payload: null });
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords: UserCoordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          dispatch({ type: 'SET_USER_LOCATION', payload: coords });
          dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Localização obtida! Otimizando rota...' });
          proceedToOptimization(coords, null);
        },
        (error) => {
          console.warn("Geolocation error:", error);
          let userMessage = 'Não foi possível obter sua localização.';
          if (error.code === error.PERMISSION_DENIED) {
            userMessage = 'Permissão de localização negada. Forneça um endereço de origem manualmente ou permita a localização.';
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: userMessage});
            dispatch({ type: 'SHOW_MANUAL_ORIGIN_MODAL', payload: true });
          } else {
             userMessage = 'Erro de geolocalização. Forneça um endereço de origem manualmente ou verifique as permissões.';
             dispatch({ type: 'SET_ERROR_MESSAGE', payload: userMessage});
             dispatch({ type: 'SHOW_MANUAL_ORIGIN_MODAL', payload: true });
          }
          dispatch({ type: 'SET_USER_LOCATION', payload: null });
          dispatch({ type: 'SET_FETCHING_LOCATION', payload: false });
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    } else { // Manual ordering
        // For manual ordering, we still need to update counts and set status to 'em_rota'
        if (state.user) {
            currentRouteIdRef.current = `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const numPackagesInRoute = validPackagesCount;
            let newEntregasHoje = state.user.entregas_hoje;
            let newEntregasGratisUtilizadas = state.user.entregas_gratis_utilizadas;

            if (state.user.plano_nome === 'Grátis') {
                newEntregasGratisUtilizadas = Math.min(state.user.entregas_dia_max, state.user.entregas_gratis_utilizadas + numPackagesInRoute);
            }
            newEntregasHoje += numPackagesInRoute;
            
            supabase.from('usuarios_rotaspeed')
                .update({ entregas_hoje: newEntregasHoje, entregas_gratis_utilizadas: newEntregasGratisUtilizadas })
                .eq('id', state.user.id)
                .then(({ error: countUpdateError }) => {
                    if (countUpdateError) console.error("Error updating counts for manual route:", countUpdateError.message || JSON.stringify(countUpdateError));
                    else dispatch({ type: 'UPDATE_USER_DELIVERY_COUNTS', payload: { entregas_hoje: newEntregasHoje, entregas_gratis_utilizadas: newEntregasGratisUtilizadas } });
                });
        }
      dispatch({ type: 'SET_PHASE', payload: AppPhase.MANUAL_ORDERING });
      navigate('/app/manual-ordering');
    }
  };

  const handleManualOriginSubmit = () => {
    dispatch({ type: 'SHOW_MANUAL_ORIGIN_MODAL', payload: false });
    if (tempManualOrigin.trim()) {
        dispatch({ type: 'SET_MANUAL_ORIGIN_ADDRESS', payload: tempManualOrigin.trim() });
        dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Endereço de origem definido. Otimizando rota...' });
        proceedToOptimization(null, tempManualOrigin.trim());
    } else {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Endereço de origem não fornecido. A rota será otimizada sem ponto de partida específico.' });
        proceedToOptimization(null, null);
    }
    setTempManualOrigin('');
  };


  return (
    // FIX: Use English status 'pending' for filtering count
    <AppShell title={`Adicionar Pacotes (${state.packages.filter(p=>p.status==='pending').length} Pendentes / ${state.totalPackagesEstimate || '...'} Estimados)`} showLogout>
      {state.isFetchingLocation && (
        <Alert type="info" message={
          <div className="flex items-center">
            <Spinner size="sm" className="mr-2" /> Obtendo sua localização para otimizar a rota...
          </div>
        }/>
      )}
      <div className="mb-4">
        <div className="flex border-b border-gray-300">
          <TabButton type={InputType.TEXT} label="Texto" icon={<DocumentTextIcon className="w-5 h-5"/>} />
          <TabButton type={InputType.PHOTO} label="Arquivo" icon={<UploadIcon className="w-5 h-5"/>} />
          <TabButton type={InputType.CAMERA} label="Câmera" icon={<CameraIcon className="w-5 h-5"/>} onClick={handleOpenCamera} />
          <TabButton type={InputType.VOICE} label="Voz" icon={<MicrophoneIcon className="w-5 h-5"/>} />
        </div>
        <div className="p-4 bg-white rounded-b-lg shadow">
          {activeTab === InputType.TEXT && (
            <form onSubmit={(e) => { e.preventDefault(); handleProcessInput(InputType.TEXT, textInput, "Entrada de texto"); }} className="space-y-3">
              <Textarea label="Digite ou cole os endereços aqui (um por linha ou separados por vírgula/ponto e vírgula)" value={textInput} onChange={(e) => setTextInput(e.target.value)} placeholder="Ex: Rua das Palmeiras, 123, Centro, São Paulo, SP, 01000-000. Destinatário: Sr. Exemplo. Tel: (11) 99999-8888" />
              <Button type="submit" variant="primary" className="w-full" isLoading={state.isLoading && !state.isFetchingLocation}>Adicionar Endereço(s) por Texto</Button>
            </form>
          )}
          {activeTab === InputType.PHOTO && (
            <div className="space-y-3">
              <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700">
                Envie foto, PDF ou planilha com endereços:
              </label>
              <Input
                id="file-upload"
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*,application/pdf,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                disabled={state.isLoading && !state.isFetchingLocation}
              />
            </div>
          )}
          {activeTab === InputType.VOICE && (
            <div className="space-y-3 text-center">
               {!state.isSpeechRecognitionSupported ? (
                <Alert type="error" message="Reconhecimento de voz não é suportado neste navegador." />
              ) : !state.isMicrophoneAvailable ? (
                <Alert type="warning" message="Microfone não detectado ou permissão negada. Se desejar usar o ditado, verifique as configurações do seu navegador e dispositivo." />
              ) : null}
              <Button onClick={handleVoiceInput} variant={isListening ? "danger" : "primary"} className="w-full" disabled={!state.isSpeechRecognitionSupported || !state.isMicrophoneAvailable || (state.isLoading && !state.isFetchingLocation) }>
                <MicrophoneIcon className="mr-2" /> {isListening ? 'Parar Gravação' : 'Iniciar Ditado'}
              </Button>
              {isListening && <p className="text-sm text-gray-600 animate-pulse">Ouvindo...</p>}
              {speechError && <Alert type="error" message={speechError} onClose={() => { /* Consider clearing speechError specifically */ }}/>}
              {transcript && !isListening && <p className="mt-2 p-2 bg-gray-100 rounded text-sm text-gray-700"><strong>Transcrito:</strong> {transcript}</p>}
            </div>
          )}
        </div>
      </div>

      {/* FIX: Use English status 'pending' for filtering */}
      {state.packages.filter(p=>p.status==='pending').length > 0 && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold mb-2 text-gray-700">Pacotes Pendentes Adicionados:</h3>
          <div className="max-h-60 overflow-y-auto bg-white rounded-lg shadow p-2 space-y-2">
            {/* FIX: Use English status 'pending' for filtering */}
            {state.packages.filter(p => p.status === 'pending').map((pkg) => (
              <div key={pkg.id} className={`p-3 rounded-md border ${pkg.status === 'error' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className={`font-medium ${pkg.status === 'error' ? 'text-red-700' : 'text-gray-800'}`}>{pkg.fullAddress}</p>
                    {pkg.recipientName && <p className="text-xs text-gray-600">Destinatário: {pkg.recipientName}</p>}
                    {pkg.telefone && <p className="text-xs text-gray-600">Telefone: {pkg.telefone}</p>}
                    <p className="text-xs text-gray-500">
                      {pkg.street && `Rua: ${pkg.street}, `}
                      {pkg.number && `Nº: ${pkg.number}, `}
                      {pkg.bairro && `Bairro: ${pkg.bairro}, `}
                      {pkg.cep && `CEP: ${pkg.cep}`}
                    </p>
                    <p className="text-xs text-gray-500">
                        {pkg.city && `Cidade: ${pkg.city}, `}
                        {pkg.state && `Estado: ${pkg.state}`}
                    </p>
                    {pkg.complemento && <p className="text-xs text-gray-500">Complemento: {pkg.complemento}</p>}
                     {pkg.inputType && <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">{InputType[pkg.inputType.toUpperCase() as keyof typeof InputType] || pkg.inputType}</span>}
                    {pkg.status === 'error' && <p className="text-xs text-red-600 mt-1">Erro: {pkg.errorMessage}</p>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleRemovePackage(pkg.id)} className="text-red-500 hover:text-red-700" disabled={state.isLoading}>
                    <TrashIcon/>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="my-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
        <RadioGroup
            name="optimizationMode"
            legend="Como deseja otimizar a rota?"
            options={optimizationOptions}
            selectedValue={state.optimizationMode}
            onChange={(value) => dispatch({ type: 'SET_OPTIMIZATION_MODE', payload: value})}
            className="mb-2"
        />
        {state.optimizationMode === 'auto' &&
            <p className="text-xs text-gray-600 ml-1">
                <InformationCircleIcon className="w-3 h-3 inline mr-1"/> Usaremos sua localização atual (se permitida) ou um endereço de origem manual para definir o ponto de partida e a IA da Gemini para otimizar.
            </p>
        }
         {state.optimizationMode === 'manual' &&
            <p className="text-xs text-gray-600 ml-1">
                <InformationCircleIcon className="w-3 h-3 inline mr-1"/> Você poderá reordenar os pacotes manualmente na próxima etapa.
            </p>
        }
      </div>
      {/* FIX: Use English status 'pending' for filtering count */}
      <Button onClick={handleConfirmAndOptimize} variant="primary" size="lg" className="w-full"
        disabled={state.packages.filter(p=>p.status === 'pending').length === 0 || state.isLoading || state.isFetchingLocation}
        isLoading={state.isLoading || state.isFetchingLocation}>
        {state.isLoading || state.isFetchingLocation ? 'Processando...' : 'Concluir e Otimizar Rota'} <ArrowPathIcon className="ml-2 w-5 h-5"/>
      </Button>

      <Modal isOpen={state.showCameraModal} onClose={() => { stopCamera(); dispatch({type: 'SHOW_CAMERA_MODAL', payload: false}); }} title="Capturar Foto do Endereço" size="lg">
          <div className="space-y-4">
            {cameraStream && cameraVideoRef.current ? ( // Condition changed to check cameraVideoRef.current for initial render
              <>
                <video ref={cameraVideoRef} autoPlay playsInline className="w-full h-auto rounded-md border bg-gray-200" aria-label="Visualização da câmera" />
                <canvas ref={cameraCanvasRef} className="hidden"></canvas>
                <Button onClick={handleCapturePhoto} variant="primary" className="w-full">Tirar Foto</Button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-40">
                <Spinner />
                <p className="mt-2 text-gray-600">Iniciando câmera...</p>
              </div>
            )}
            <Button onClick={() => { stopCamera(); dispatch({type: 'SHOW_CAMERA_MODAL', payload: false}); }} variant="secondary" className="w-full">Cancelar</Button>
          </div>
      </Modal>

      <Modal
        isOpen={state.showManualOriginModal}
        onClose={() => {
            dispatch({ type: 'SHOW_MANUAL_ORIGIN_MODAL', payload: false });
            if (state.optimizationMode === 'auto' && !state.userLocation && !state.manualOriginAddress) {
                dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Nenhuma origem fornecida. A rota será otimizada sem ponto de partida específico.' });
                proceedToOptimization(null, null); // Proceed without origin if modal closed without submit
            }
        }}
        title="Endereço de Origem Manual"
      >
        <p className="text-sm text-gray-600 mb-3">Não foi possível obter sua localização ou a permissão foi negada. Por favor, insira seu endereço de partida para otimizar a rota, ou deixe em branco para otimizar sem um ponto de partida específico.</p>
        <Input
            label="Seu endereço de partida"
            value={tempManualOrigin}
            onChange={(e) => setTempManualOrigin(e.target.value)}
            placeholder="Ex: Rua Minha Casa, 10, Meu Bairro, Minha Cidade"
            className="mb-4"
        />
        <div className="flex justify-end space-x-2">
            <Button variant="ghost" onClick={() => {
                 dispatch({ type: 'SHOW_MANUAL_ORIGIN_MODAL', payload: false });
                 dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Nenhuma origem fornecida. A rota será otimizada sem ponto de partida específico.' });
                 proceedToOptimization(null, null);
            }}>Otimizar Sem Origem</Button>
            <Button variant="primary" onClick={handleManualOriginSubmit}>Confirmar Origem e Otimizar</Button>
        </div>
      </Modal>

    </AppShell>
  );
};

const ManualOrderingPage: React.FC = () => {
    const { state, dispatch } = useSharedState();
    const navigate = useNavigate();
    const [orderedPackages, setOrderedPackages] = useState<PackageInfo[]>([]);
    const currentRouteIdRef = useRef<string | null>(null);


    useEffect(() => {
        // FIX: Use English status 'pending' for filtering
        const validPackages = state.packages.filter(p => p.status === 'pending' && p.fullAddress !== 'Endereço não reconhecido');
        setOrderedPackages(validPackages);
         if (validPackages.length > 0 && !currentRouteIdRef.current) {
            currentRouteIdRef.current = `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
    }, [state.packages]);

    const movePackage = (index: number, direction: 'up' | 'down') => {
        const newPackages = [...orderedPackages];
        const pkgToMove = newPackages[index];
        if (direction === 'up' && index > 0) {
            newPackages.splice(index, 1);
            newPackages.splice(index - 1, 0, pkgToMove);
        } else if (direction === 'down' && index < newPackages.length - 1) {
            newPackages.splice(index, 1);
            newPackages.splice(index + 1, 0, pkgToMove);
        }
        setOrderedPackages(newPackages);
    };

    const handleConfirmOrder = async () => {
        if (orderedPackages.length === 0) {
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Nenhum pacote para ordenar.' });
            return;
        }
        if (!state.user) {
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Usuário não autenticado.' });
            return;
        }
        dispatch({ type: 'SET_LOADING', payload: true });

        // FIX: Use DB status 'em_rota'
        const updatesForDb: Array<{ id: string; optimized_order: number; route_id: string; status: EntregaDbRecord['status']}> = orderedPackages.map((pkg, index) => ({
            id: pkg.id,
            optimized_order: index + 1,
            route_id: currentRouteIdRef.current!,
            status: 'em_rota', 
        }));

        try {
            await updateMultipleEntregasOptimization(updatesForDb);
            // FIX: Dispatch with English status 'in_transit'
            dispatch({ type: 'SET_MANUALLY_ORDERED_PACKAGES', payload: orderedPackages.map((pkg,index) => ({...pkg, order: index + 1, status: 'in_transit', route_id: currentRouteIdRef.current!})) });
            // SET_MANUALLY_ORDERED_PACKAGES action handles navigation based on plan status
        } catch (dbError: any) {
            console.error("Error updating packages for manual order:", dbError.message || JSON.stringify(dbError));
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Erro ao salvar ordem manual: ${dbError.message}` });
        } finally {
             dispatch({ type: 'SET_LOADING', payload: false });
        }
    };

    if (state.phase !== AppPhase.MANUAL_ORDERING && state.phase !== AppPhase.LIMIT_REACHED && state.phase !== AppPhase.PLAN_EXPIRED) {
        if (state.optimizedRoute.length > 0 && state.phase === AppPhase.DELIVERY) {
            return <Navigate to="/app/delivery" replace />;
        }
        return <Navigate to={state.user?.plano_ativo ? "/app/package-input" : "/"} replace />;
    }


    return (
        <AppShell title="Ordenar Entregas Manualmente" showLogout>
            <p className="text-sm text-gray-600 mb-4">
                Clique nas setas para reordenar os pacotes. A ordem aqui definida será a sua rota de entrega.
            </p>
            {orderedPackages.length === 0 && (
                <Alert type="info" message="Nenhum pacote válido para ordenar. Adicione pacotes na etapa anterior."/>
            )}
            <div className="space-y-2 mb-6 max-h-[60vh] overflow-y-auto">
                {orderedPackages.map((pkg, index) => (
                    <div key={pkg.id} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-md shadow-sm">
                        <div className="flex items-center">
                           <span className="text-gray-500 mr-3 font-medium tabular-nums">#{index + 1}</span>
                           <div>
                            <p className="font-medium text-gray-800">{pkg.fullAddress}</p>
                            {pkg.recipientName && <p className="text-xs text-gray-600">Dest.: {pkg.recipientName}</p>}
                            {pkg.telefone && <p className="text-xs text-gray-600">Tel.: {pkg.telefone}</p>}
                            {pkg.bairro && <p className="text-xs text-gray-500">Bairro: {pkg.bairro}</p>}
                            {pkg.complemento && <p className="text-xs text-gray-500">Compl.: {pkg.complemento}</p>}
                            <p className="text-xs text-gray-500">{pkg.inputType ? InputType[pkg.inputType.toUpperCase() as keyof typeof InputType] : ''} - {pkg.originalInput?.substring(0,30)}...</p>
                           </div>
                        </div>
                        <div className="flex space-x-1">
                            <Button size="sm" variant="ghost" onClick={() => movePackage(index, 'up')} disabled={index === 0} aria-label={`Mover ${pkg.fullAddress} para cima`}>
                                <ArrowUpIcon />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => movePackage(index, 'down')} disabled={index === orderedPackages.length - 1} aria-label={`Mover ${pkg.fullAddress} para baixo`}>
                                <ArrowDownIcon />
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
            <Button onClick={handleConfirmOrder} variant="primary" size="lg" className="w-full" disabled={orderedPackages.length === 0 || state.isLoading}>
                Confirmar Ordem e Iniciar Entregas
            </Button>
        </AppShell>
    );
};


const DeliveryPage: React.FC = () => {
  const { state, dispatch } = useSharedState();
  const navigate = useNavigate();
  const [showIndividualNotificationModal, setShowIndividualNotificationModal] = useState(false);
  const [selectedPackageForNotification, setSelectedPackageForNotification] = useState<RouteStop | null>(null);

  const currentPackage = state.optimizedRoute[state.currentStopIndex];
  // FIX: Use English status 'delivered' and 'cancelled'
  const remainingDeliveries = state.optimizedRoute.filter(p => p.status !== 'delivered' && p.status !== 'cancelled').length;

  useEffect(() => {
    if (state.phase === AppPhase.DELIVERY && state.optimizedRoute.length === 0 && !state.isLoading) {
        navigate('/app/package-input');
    // FIX: Use English status 'delivered' and 'cancelled'
    } else if (currentPackage && (currentPackage.status === 'delivered' || currentPackage.status === 'cancelled')) {
        if (remainingDeliveries > 0 && state.currentStopIndex < state.optimizedRoute.length -1) {
            // Find next non-delivered/non-cancelled stop
            let nextStopFound = false;
            for (let i = state.currentStopIndex + 1; i < state.optimizedRoute.length; i++) {
                // FIX: Use English status 'delivered' and 'cancelled'
                if (state.optimizedRoute[i].status !== 'delivered' && state.optimizedRoute[i].status !== 'cancelled') {
                    // dispatch({ type: 'SET_CURRENT_STOP_INDEX', payload: i }); // Needs new action
                    // For now, using existing NEXT_STOP logic which just increments. This needs refinement.
                    dispatch({ type: 'NEXT_STOP' }); // This might skip multiple delivered items
                    nextStopFound = true;
                    break;
                }
            }
            if (!nextStopFound && remainingDeliveries === 0) { // All remaining were delivered/cancelled
                 dispatch({type: 'SET_PHASE', payload: AppPhase.COMPLETED});
                 navigate('/app/completed');
            } else if (!nextStopFound && remainingDeliveries > 0) {
                // This means all subsequent stops are delivered/cancelled but some earlier ones are not.
                // This indicates a complex state, perhaps just go to completed or re-evaluate.
                // For now, the existing NEXT_STOP will eventually lead to COMPLETED.
                 dispatch({ type: 'NEXT_STOP' }); 
            }
        } else if (remainingDeliveries === 0) {
            dispatch({type: 'SET_PHASE', payload: AppPhase.COMPLETED});
            navigate('/app/completed');
        }
    }
  }, [state.optimizedRoute, state.isLoading, navigate, dispatch, currentPackage, remainingDeliveries, state.currentStopIndex, state.phase]);


  if (state.isLoading && state.optimizedRoute.length === 0 && (state.phase as AppPhase) !== AppPhase.COMPLETED) {
      return <AppShell title="Otimizando Rota..."><div className="flex flex-col items-center justify-center h-full"><Spinner className="mx-auto mt-10" /><p className="mt-2">Aguarde...</p></div></AppShell>;
  }

  if (state.phase === AppPhase.COMPLETED || (!currentPackage && state.phase !== AppPhase.ROUTE_OPTIMIZATION && state.optimizedRoute.length > 0) ) {
      // FIX: Use English status 'delivered' and 'cancelled'
      const allActuallyDeliveredOrCancelled = state.optimizedRoute.every(p => p.status === 'delivered' || p.status === 'cancelled');
      if (allActuallyDeliveredOrCancelled && state.phase !== AppPhase.COMPLETED) {
          dispatch({type: 'SET_PHASE', payload: AppPhase.COMPLETED});
      }
      return <Navigate to="/app/completed" replace />;
  }

  if (!currentPackage && (state.phase === AppPhase.DELIVERY || state.phase === AppPhase.LIMIT_REACHED || state.phase === AppPhase.PLAN_EXPIRED)) {
     if(state.phase === AppPhase.LIMIT_REACHED || state.phase === AppPhase.PLAN_EXPIRED) {
        // Stay on current page or navigate to a specific limit/expired page if needed.
     } else {
        return <Navigate to="/app/package-input" replace />;
     }
  }
  
  // FIX: Pass DB status to updateEntregaStatus, map to PackageInfo status for local dispatch
  const handleUpdatePackageStatus = async (dbStatus: EntregaDbRecord['status']) => {
    if (currentPackage && state.user) {
      dispatch({ type: 'SET_LOADING', payload: true });
      try {
        await updateEntregaStatus(currentPackage.id, dbStatus);
        const packageStatus = mapDBStatusToPackageStatus(dbStatus);
        // FIX: Dispatch UPDATE_PACKAGE_STATUS with the mapped English status
        dispatch({ type: 'UPDATE_PACKAGE_STATUS', payload: { id: currentPackage.id, newStatus: packageStatus } });
        dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: `Pacote marcado como ${dbStatus === 'entregue' ? 'entregue' : 'cancelado'}.` });

      } catch (error: any) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Erro ao atualizar status: ${error.message}` });
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }
  };


  const openNavigationApp = () => {
    if (currentPackage && state.user) {
      const addressParts = [
        currentPackage.street,
        currentPackage.number,
        currentPackage.bairro,
        currentPackage.city,
        currentPackage.state,
        currentPackage.cep,
      ].filter(Boolean).join(', ');
      const fullAddressForMap = addressParts || currentPackage.fullAddress.replace(currentPackage.complemento || '', '').replace(currentPackage.telefone || '', '').trim();
      const encodedAddress = encodeURIComponent(fullAddressForMap);
      
      let navUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`; // Default to Google Maps

      const preference = state.user.navigation_preference;
      if (preference === 'waze') {
        navUrl = `https://waze.com/ul?q=${encodedAddress}&navigate=yes`;
      } else if (preference === 'apple') {
        navUrl = `http://maps.apple.com/?q=${encodedAddress}`;
      }
      window.open(navUrl, '_blank');
    }
  };

  const handleSimulateIndividualNotification = (pkg: RouteStop) => {
    setSelectedPackageForNotification(pkg);
    setShowIndividualNotificationModal(true);
  };

  const handleNotifyAllConfirmation = (notify: boolean) => {
    dispatch({ type: 'SHOW_NOTIFY_ALL_MODAL', payload: false });
    if (notify && state.user) {
        // FIX: Use English status 'delivered' and 'cancelled'
        const pendingPackagesWithPhones = state.optimizedRoute.filter(p => p.status !== 'delivered' && p.status !== 'cancelled' && p.telefone);
        if (pendingPackagesWithPhones.length === 0) {
            dispatch({ type: 'SET_INFO_MESSAGE', payload: 'Nenhum cliente com telefone cadastrado para notificar.' });
            return;
        }

        let notificationsSentCount = 0;
        const senderNumber = state.user.notification_sender_preference === 'driver' ? state.user.driver_phone : 'SYSTEM_NUMBER_PLACEHOLDER'; // Placeholder for system number

        pendingPackagesWithPhones.forEach(pkg => {
            if (pkg.telefone) {
                const cleanedPhone = pkg.telefone.replace(/\D/g, '');
                let fullPhoneNumber = cleanedPhone;

                if (!fullPhoneNumber.startsWith('55') && (fullPhoneNumber.length === 10 || fullPhoneNumber.length === 11)) {
                    fullPhoneNumber = '55' + fullPhoneNumber;
                }
                // Message construction (adapt as needed)
                const driverName = state.user?.driver_name || "Seu entregador";
                const message = `Olá ${pkg.recipientName || 'Cliente'}, ${driverName} da RotaSpeed está a caminho com sua entrega! Você é a ${pkg.order}ª parada.`;
                const encodedMessage = encodeURIComponent(message);
                const whatsappUrl = `https://wa.me/${fullPhoneNumber}?text=${encodedMessage}`;

                // Actual API call for WhatsApp would go here if integrated, using senderNumber
                // For now, it opens links:
                try {
                    const win = window.open(whatsappUrl, '_blank');
                    if (!win || win.closed || typeof win.closed === 'undefined') {
                        console.warn(`Não foi possível abrir o WhatsApp para ${fullPhoneNumber}. Pode ter sido bloqueado.`);
                    }
                    notificationsSentCount++;
                } catch (e) {
                    console.error(`Erro ao tentar abrir WhatsApp para ${fullPhoneNumber}:`, e);
                }
            }
        });

        if (notificationsSentCount > 0) {
            dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: `${notificationsSentCount} cliente(s) notificado(s) via WhatsApp (links abertos).` });
        } else {
            dispatch({ type: 'SET_INFO_MESSAGE', payload: 'Nenhum cliente com telefone válido encontrado para notificar.' });
        }
    }
  };

  const handleShareRouteLinks = async () => {
    if (state.optimizedRoute.length === 0) {
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Nenhuma rota para compartilhar.' });
        return;
    }
    // FIX: Use English status 'delivered' and 'cancelled'
    const pendingStops = state.optimizedRoute.filter(p => p.status !== 'delivered' && p.status !== 'cancelled');
    if (pendingStops.length === 0) {
        dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Todas as entregas foram concluídas ou canceladas. Nada para compartilhar.' });
        return;
    }

    const routeLinksText = pendingStops.map((stop) => {
        const addressParts = [stop.street, stop.number, stop.bairro, stop.city, stop.state, stop.cep].filter(Boolean).join(', ');
        const fullAddressForMap = addressParts || stop.fullAddress.replace(stop.complemento || '', '').replace(stop.telefone || '', '').trim();
        return `${stop.order}. ${stop.fullAddress} (Dest.: ${stop.recipientName || 'N/A'}): https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddressForMap)}`;
    }).join('\n\n');

    const shareData = {
        title: 'Minha Rota de Entregas RotaSpeed',
        text: `Aqui estão os links para minhas próximas entregas:\n\n${routeLinksText}`,
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
            dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Rota compartilhada!' });
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(shareData.text);
            dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Links da rota copiados para a área de transferência!' });
        } else {
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Compartilhamento não suportado neste navegador.' });
        }
    } catch (err) {
        console.error('Error sharing route:', err);
        if ((err as DOMException).name !== 'AbortError') {
          dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Erro ao compartilhar a rota.' });
        }
    }
  };

    if (state.phase === AppPhase.PLAN_EXPIRED || state.phase === AppPhase.LIMIT_REACHED) {
        const message = state.phase === AppPhase.PLAN_EXPIRED
            ? "Seu plano está inativo. Por favor, reative ou atualize seu plano para continuar."
            : `Você atingiu seu limite de entregas para ${state.user?.plano_nome === 'Grátis' ? 'o período gratuito' : 'hoje'}.`;
        return (
            <AppShell title="Atenção" showLogout>
                <Alert type="warning" message={message} />
                <Button onClick={() => navigate('/app/subscription-info')} variant="primary" className="mt-4">
                    Ver Planos
                </Button>
                <Button onClick={() => { dispatch({ type: 'CLEAR_PACKAGES_AND_ROUTE' }); navigate("/app/package-setup"); }} variant="secondary" className="mt-2">
                    Voltar ao Início
                </Button>
            </AppShell>
        );
    }
    
    if (!currentPackage) {
      return (
         <AppShell title="Nenhuma entrega atual" showLogout>
            <Alert type="info" message="Não há nenhuma entrega na rota atual ou a rota não foi carregada."/>
            <Button onClick={() => navigate('/app/package-input')} variant="primary" className="mt-4">
                Adicionar Pacotes
            </Button>
         </AppShell>
      );
    }

  return (
    <AppShell title={`Entrega ${currentPackage.order} de ${state.optimizedRoute.length}`} showLogout>
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h2 className="text-2xl font-bold text-blue-700 mb-1">Próxima Parada: #{currentPackage.order}</h2>
          <p className="text-lg text-gray-800 font-semibold">{currentPackage.fullAddress}</p>
          {currentPackage.recipientName && <p className="text-sm text-gray-700">Destinatário: {currentPackage.recipientName}</p>}
          {currentPackage.telefone && <p className="text-sm text-gray-700">Telefone: {currentPackage.telefone}</p>}
          <p className="text-sm text-gray-600">
            {currentPackage.street && `${currentPackage.street}, `}
            {currentPackage.number && `${currentPackage.number}, `}
            {currentPackage.bairro && `Bairro: ${currentPackage.bairro}, `}
            {currentPackage.cep && `CEP: ${currentPackage.cep}`}
          </p>
          <p className="text-sm text-gray-600">
            {currentPackage.city && `${currentPackage.city} - `}
            {currentPackage.state && `${currentPackage.state}`}
          </p>
          {currentPackage.complemento && <p className="text-sm text-gray-600 font-semibold mt-1">Complemento: {currentPackage.complemento}</p>}
          {currentPackage.originalInput && <p className="text-xs text-gray-500 mt-1">Entrada: {currentPackage.originalInput.substring(0,100)}...</p>}
        </div>

        <Button onClick={openNavigationApp} variant="primary" size="lg" className="w-full">
          <MapPinIcon className="mr-2" /> Navegar com {state.user?.navigation_preference ? state.user.navigation_preference.charAt(0).toUpperCase() + state.user.navigation_preference.slice(1) : 'Google Maps'}
        </Button>
        <div className="grid grid-cols-2 gap-3">
            {/* FIX: Pass DB status 'entregue' */}
            <Button onClick={() => handleUpdatePackageStatus('entregue')} variant="secondary" size="lg" className="w-full bg-green-500 hover:bg-green-600 text-white">
              <CheckCircleIcon className="mr-2" /> Entregue
            </Button>
            {/* FIX: Pass DB status 'cancelada' */}
            <Button onClick={() => handleUpdatePackageStatus('cancelada')} variant="secondary" size="lg" className="w-full bg-red-500 hover:bg-red-600 text-white">
              <XCircleIcon className="mr-2" /> Cancelada
            </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button onClick={() => handleSimulateIndividualNotification(currentPackage)} variant="ghost" size="md" className="w-full text-green-600 hover:bg-green-50 border border-green-200" disabled={!currentPackage.telefone}>
              <WhatsAppIcon className="mr-2"/> Notificar Cliente Atual
            </Button>
            <Button onClick={handleShareRouteLinks} variant="ghost" size="md" className="w-full text-blue-600 hover:bg-blue-50 border border-blue-200">
                <ShareIcon className="mr-2"/> Compartilhar Links da Rota
            </Button>
        </div>

        <div className="text-center text-gray-700">
          <p className="text-xl font-semibold">{remainingDeliveries} entregas restantes</p>
        </div>
      </div>

      <Modal
        isOpen={showIndividualNotificationModal && !!selectedPackageForNotification}
        onClose={() => { setShowIndividualNotificationModal(false); setSelectedPackageForNotification(null);}}
        title={`Simular Notificações para: #${selectedPackageForNotification?.order}`}
        size="lg"
       >
        {selectedPackageForNotification && (
            <>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto p-1">
                <p className="font-semibold text-sm text-gray-800">Para: {selectedPackageForNotification.fullAddress.substring(0,50)}...</p>
                {selectedPackageForNotification.recipientName && <p className="text-xs text-gray-600">Destinatário: {selectedPackageForNotification.recipientName}</p>}
                {selectedPackageForNotification.telefone && <p className="text-xs text-gray-600">Telefone: {selectedPackageForNotification.telefone}</p>}
                <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-start p-2 bg-green-50 border border-green-200 rounded">
                        <WhatsAppIcon className="w-4 h-4 mr-1.5 mt-0.5 text-green-600 flex-shrink-0"/>
                        <span className="text-green-700">Olá {selectedPackageForNotification.recipientName || 'Cliente'}! Sua entrega RotaSpeed está a caminho! Você é a {selectedPackageForNotification.order}ª parada em nossa rota de hoje. (WhatsApp Simulado)</span>
                    </div>
                        <div className="flex items-start p-2 bg-blue-50 border border-blue-200 rounded">
                        <PaperAirplaneIcon className="w-4 h-4 mr-1.5 mt-0.5 text-blue-600 flex-shrink-0 transform -rotate-45"/>
                        <span className="text-blue-700">"Olá {selectedPackageForNotification.recipientName || 'Cliente'}! Sua entrega RotaSpeed está a caminho!" (Ligação de Voz Simulada - consumiria 1 crédito de voz)</span>
                    </div>
                </div>
            </div>
            <div className="mt-4 text-xs text-gray-500">
                <InformationCircleIcon className="w-4 h-4 inline mr-1"/>Isto é uma simulação.
                <Link to="/app/subscription-info" onClick={() => setShowIndividualNotificationModal(false)} className="text-blue-600 hover:underline ml-1">Ver Planos e Créditos.</Link>
            </div>
            </>
        )}
        <div className="p-4 border-t flex justify-end space-x-2 bg-gray-50 mt-4"> {/* Replaced footer prop with direct rendering */}
            <Button variant="secondary" onClick={() => { setShowIndividualNotificationModal(false); setSelectedPackageForNotification(null);}}>Fechar</Button>
        </div>
      </Modal>

       <Modal
        isOpen={state.showNotifyAllModal}
        onClose={() => handleNotifyAllConfirmation(false)}
        title="Notificar Clientes"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => handleNotifyAllConfirmation(false)}>Não, obrigado</Button>
            <Button variant="primary" onClick={() => handleNotifyAllConfirmation(true)}>Sim, Notificar Todos</Button>
          </>
        }
      >
        <p className="text-gray-700 mb-2">Deseja notificar todos os clientes sobre as entregas de hoje via WhatsApp (links serão abertos)?</p>
        <p className="text-xs text-gray-500">
            Serão abertas janelas/guias do WhatsApp para os
            {/* FIX: Use English status 'delivered' and 'cancelled' */}
            <strong className="mx-1">{state.optimizedRoute.filter(p => (p.status !== 'delivered' && p.status !== 'cancelled') && p.telefone).length}</strong>
            clientes com telefone cadastrado e entregas pendentes.
        </p>
         <p className="text-xs text-yellow-600 mt-2">
            <ExclamationTriangleIcon className="w-3 h-3 inline mr-1"/> Seu navegador pode bloquear múltiplas janelas. Permita-as se solicitado.
        </p>
      </Modal>
      <Modal
        isOpen={state.showUpgradeModal}
        onClose={() => dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: false })}
        title={state.user?.plano_ativo === false ? "Plano Inativo" : "Limite Atingido"}
      >
        <p className="text-gray-700 mb-4">
          {state.errorMessage || (state.user?.plano_ativo === false ? "Seu plano está atualmente inativo." :
           state.user?.plano_nome === 'Grátis' ? `Você utilizou todas as suas ${state.user.entregas_dia_max} entregas grátis.` :
           `Você atingiu seu limite diário de ${state.user?.entregas_dia_max} entregas para o plano ${state.user?.plano_nome}.`)
          }
        </p>
        <p className="text-gray-700 mb-4">
          Para continuar utilizando o RotaSpeed e otimizar mais entregas, por favor, reative seu plano ou faça um upgrade.
        </p>
        <Button
            onClick={() => {
                navigate('/app/subscription-info');
                dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: false });
            }}
            variant="primary"
            className="w-full"
        >
          Ver Planos de Assinatura
        </Button>
      </Modal>
    </AppShell>
  );
};

const CompletedPage: React.FC = () => {
  const { dispatch, state } = useSharedState();

  const handleNewRoute = () => {
    dispatch({ type: 'CLEAR_PACKAGES_AND_ROUTE' });
    // Navigation is handled by CLEAR_PACKAGES_AND_ROUTE depending on plan status
    // navigate("/app/package-setup") is implicit if plan is active
  };
  // FIX: Use English status 'delivered'
  const deliveredCount = state.optimizedRoute.filter(p => p.status === 'delivered').length;

  return (
    <AppShell title="Entregas Concluídas!" showLogout>
      <div className="text-center space-y-6 py-10">
        <CheckCircleIcon className="w-24 h-24 text-green-500 mx-auto" />
        <h1 className="text-3xl font-bold text-gray-800">Parabéns, {state.user?.nome || state.user?.driver_name || state.user?.email || 'Entregador'}!</h1>
        <p className="text-lg text-gray-600">
          {deliveredCount > 0 ? `Suas ${deliveredCount} entregas foram concluídas com sucesso.` : "Nenhuma entrega registrada como concluída nesta rota."}
        </p>
        <Button onClick={handleNewRoute} variant="primary" size="lg" className="min-w-[200px]">
          Iniciar Nova Rota
        </Button>
      </div>
    </AppShell>
  );
};

const SubscriptionInfoPage: React.FC = () => {
    const plans = [
        { name: "🚀 Speed Fácil", price: "R$ 29,90", deliveries: "Até 85/dia", ideal: "Ideal para motoboys autônomos", link: "https://pay.cakto.com.br/3c5f6ie_389522", features: [] },
        { name: "🚗 Plano Motorista", price: "R$ 49,90", deliveries: "Até 155/dia", ideal: "Para motoristas com volume médio", link: "https://pay.cakto.com.br/bcim7ia_389518", features: [] },
        { name: "🔝 RotaSpeed Profissional", price: "R$ 79,90", deliveries: "Até 170/dia", ideal: "Inclui todos os recursos e exportações", link: "https://pay.cakto.com.br/3ckniys_393394", features: ["Exportações"] },
        { name: "💼 Premium Inteligente", price: "R$ 197,00", deliveries: "Até 255/dia", ideal: "Para alto volume e recursos premium", link: "https://pay.cakto.com.br/3ayqmsj_393401", features: ["700 créditos de ligação", "Prioridade atualizações", "Suporte premium"] },
    ];

    const voiceCredits = [
        { name: "Pacote 100 créditos", price: "R$ 25,00", link: "https://pay.cakto.com.br/nb3bu7j_393417" },
        { name: "Pacote 300 créditos", price: "R$ 69,00", link: "https://pay.cakto.com.br/jw95qdf_393425" },
        { name: "Pacote 600 créditos", price: "R$ 199,00", link: "https://pay.cakto.com.br/sjcddtr_393428" },
    ];

    return (
        <AppShell title="Planos e Créditos RotaSpeed" showLogout>
            <div className="space-y-10">
                <section>
                    <h3 className="text-2xl font-semibold text-gray-800 mb-6 pb-2 border-b">Nossos Planos</h3>
                    <div className="grid md:grid-cols-2 gap-6">
                        {plans.map(plan => (
                            <div key={plan.name} className="bg-white border border-gray-200 rounded-lg shadow-lg p-6 flex flex-col">
                                <h4 className="text-xl font-bold text-blue-600 mb-2">{plan.name}</h4>
                                <p className="text-3xl font-extrabold text-gray-900 mb-1">{plan.price}<span className="text-sm font-normal text-gray-500">/mês</span></p>
                                <p className="text-gray-600 font-medium mb-1"><PackageIcon className="w-4 h-4 inline mr-1"/> {plan.deliveries}</p>
                                <p className="text-sm text-gray-500 mb-3 flex-grow">{plan.ideal}</p>
                                {plan.features.length > 0 && (
                                    <ul className="text-sm text-gray-600 mb-4 space-y-1 list-inside list-disc flex-grow">
                                        {plan.features.map(feature => <li key={feature}>{feature}</li>)}
                                    </ul>
                                )}
                                <Button
                                    onClick={() => window.open(plan.link, '_blank')}
                                    variant="primary"
                                    className="w-full mt-auto"
                                >
                                    Contratar Plano
                                </Button>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <h3 className="text-2xl font-semibold text-gray-800 mb-6 pb-2 border-b">Créditos Adicionais de Voz</h3>
                    <p className="text-gray-600 mb-4">Para ligações automatizadas aos seus clientes, avisando sobre a entrega.</p>
                    <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
                        {voiceCredits.map(credit => (
                            <div key={credit.name} className="bg-white border border-gray-200 rounded-lg shadow-md p-6 flex flex-col">
                                <h4 className="text-lg font-bold text-blue-600 mb-2">{credit.name}</h4>
                                <p className="text-2xl font-extrabold text-gray-900 mb-3">{credit.price}</p>
                                 <Button
                                    onClick={() => window.open(credit.link, '_blank')}
                                    variant="secondary"
                                    className="w-full mt-auto"
                                >
                                    Comprar Créditos
                                </Button>
                            </div>
                        ))}
                    </div>
                </section>
                 <p className="text-xs text-center text-gray-500 mt-8">
                    Links de pagamento processados por CAKTO. Preços e condições sujeitos a alterações.
                </p>
            </div>
        </AppShell>
    );
};

// --- NEW PAGES ---
const SettingsPage: React.FC = () => {
    const { state, dispatch } = useSharedState();
    const [displayName, setDisplayName] = useState(state.user?.nome || ''); // For user's actual name
    const [driverName, setDriverName] = useState(state.user?.driver_name || '');
    const [driverPhone, setDriverPhone] = useState(state.user?.driver_phone || '');
    const [navPreference, setNavPreference] = useState(state.user?.navigation_preference || 'google');
    const [notificationSender, setNotificationSender] = useState(state.user?.notification_sender_preference || 'driver');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (state.user) {
            setDisplayName(state.user.nome || '');
            setDriverName(state.user.driver_name || '');
            setDriverPhone(state.user.driver_phone || '');
            setNavPreference(state.user.navigation_preference || 'google');
            setNotificationSender(state.user.notification_sender_preference || 'driver');
        }
    }, [state.user]);

    const handleSaveChanges = async () => {
        if (!state.user) return;
        setIsSaving(true);
        dispatch({type: 'SET_ERROR_MESSAGE', payload: null});
        dispatch({type: 'SET_SUCCESS_MESSAGE', payload: null});

        const settingsToUpdate: Partial<User> = {
            nome: displayName, // Save 'nome'
            driver_name: driverName,
            driver_phone: driverPhone,
            navigation_preference: navPreference,
            notification_sender_preference: notificationSender,
        };

        try {
            const updatedUser = await updateUserProfileSettings(state.user.id, settingsToUpdate);
            if (updatedUser) {
                dispatch({ type: 'UPDATE_USER_SETTINGS_SUCCESS', payload: updatedUser });
                dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Configurações salvas com sucesso!' });
            }
        } catch (error: any) {
            dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Erro ao salvar configurações: ${error.message}` });
        } finally {
            setIsSaving(false);
        }
    };
    
    const navOptions = [
        { value: 'google', label: 'Google Maps' },
        { value: 'waze', label: 'Waze' },
        { value: 'apple', label: 'Apple Maps (iPhone)' },
    ];

    const senderOptions = [
        { value: 'driver', label: 'Meu Número (Configurado Abaixo)' },
        { value: 'system', label: 'Número do Sistema RotaSpeed (se disponível no plano)' },
    ];


    return (
        <AppShell title="Configurações" showLogout>
            <div className="space-y-8">
                 <section>
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Perfil</h3>
                    <div className="space-y-4">
                        <Input label="Seu Nome Completo" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Ex: João da Silva" />
                        <Input label="E-mail (não editável)" value={state.user?.email || ''} readOnly disabled className="bg-gray-100" />
                    </div>
                </section>
                <section>
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Informações do Entregador (para notificações)</h3>
                    <div className="space-y-4">
                        <Input label="Nome do Entregador (Ex: João Entregas)" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Ex: João Entregas" />
                        <Input type="tel" label="Telefone do Entregador (para notificações 'Meu Número')" value={driverPhone} onChange={e => setDriverPhone(e.target.value)} placeholder="Ex: (11) 99999-8888" />
                    </div>
                </section>
                <section>
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Preferências de Navegação</h3>
                     <RadioGroup
                        name="navPreference"
                        legend="Aplicativo de Navegação Padrão"
                        options={navOptions.map(opt => ({value: opt.value, label: opt.label}))}
                        selectedValue={navPreference}
                        onChange={(value) => setNavPreference(value)}
                    />
                </section>
                 <section>
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Preferências de Notificação ao Cliente</h3>
                     <RadioGroup
                        name="notificationSender"
                        legend="Enviar notificações de WhatsApp usando:"
                        options={senderOptions.map(opt => ({value: opt.value, label: opt.label}))}
                        selectedValue={notificationSender}
                        onChange={(value) => setNotificationSender(value)}
                    />
                     <p className="text-xs text-gray-500 mt-1">A opção "Número do Sistema" depende da disponibilidade e do seu plano.</p>
                </section>

                 <section>
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Seu Plano Atual</h3>
                    <div className="p-4 bg-gray-100 rounded-md">
                        <p className="font-medium text-gray-800">{state.user?.plano_nome || 'N/A'}</p>
                        <p className="text-sm text-gray-600">Entregas hoje: {state.user?.entregas_hoje || 0} / {state.user?.entregas_dia_max || 'N/A'}</p>
                        {state.user?.plano_nome === 'Grátis' && <p className="text-sm text-gray-600">Entregas grátis utilizadas: {state.user?.entregas_gratis_utilizadas || 0} / {state.user?.entregas_dia_max || 'N/A'}</p>}
                        <p className="text-sm text-gray-600">Créditos de voz: {state.user?.saldo_creditos || 0}</p>
                        <Link to="/app/subscription-info" className="text-sm text-blue-600 hover:underline mt-1 inline-block">Ver todos os planos</Link>
                    </div>
                </section>

                <Button onClick={handleSaveChanges} variant="primary" isLoading={isSaving} className="w-full sm:w-auto">
                    Salvar Alterações
                </Button>
            </div>
        </AppShell>
    );
};

const StatisticsPage: React.FC = () => {
    const { state, dispatch } = useSharedState();
    const [stats, setStats] = useState<{
        byStatus: Record<string, number>;
        byBairro: Array<{ bairro: string; count: number }>;
        byDay: Array<{ date: string; count: number }>;
        performance: { delivered: number; total: number; rate: number };
    } | null>(null);
    const [loadingStats, setLoadingStats] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            if (!state.user) return;
            setLoadingStats(true);
            try {
                const entregas = await getEntregasByUserId(state.user.id); // Fetches PackageInfo[] with English statuses
                
                const byStatus: Record<string, number> = {};
                entregas.forEach(e => {
                    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
                });

                const bairroCounts: Record<string, number> = {};
                 // FIX: Use English status 'delivered'
                entregas.filter(e => e.status === 'delivered' && e.bairro).forEach(e => {
                    bairroCounts[e.bairro!] = (bairroCounts[e.bairro!] || 0) + 1;
                });
                const byBairro = Object.entries(bairroCounts)
                    .map(([bairro, count]) => ({ bairro, count }))
                    .sort((a, b) => b.count - a.count);

                const dayCounts: Record<string, number> = {};
                // FIX: Use English status 'delivered' and PackageInfo has created_at
                 entregas.filter(e => e.status === 'delivered' && e.created_at).forEach(e => {
                    const date = new Date(e.created_at!).toISOString().split('T')[0];
                    dayCounts[date] = (dayCounts[date] || 0) + 1;
                });
                const byDay = Object.entries(dayCounts)
                    .map(([date, count]) => ({ date, count }))
                    .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                // FIX: Use English status 'delivered', 'cancelled', 'undeliverable', 'pending'
                const delivered = byStatus['delivered'] || 0;
                const attempted = entregas.filter(e => e.status === 'delivered' || e.status === 'cancelled' || e.status === 'undeliverable').length;
                const performance = {
                    delivered,
                    total: attempted > 0 ? attempted : (byStatus['pending'] || 0) + delivered, 
                    rate: attempted > 0 ? (delivered / attempted) * 100 : 0,
                };

                setStats({ byStatus, byBairro, byDay, performance });
            } catch (error: any) {
                dispatch({ type: 'SET_ERROR_MESSAGE', payload: `Erro ao carregar estatísticas: ${error.message}` });
            } finally {
                setLoadingStats(false);
            }
        };

        if (state.user) {
            fetchStats();
        }
    }, [state.user, dispatch]);

    if (loadingStats) {
        return <AppShell title="Estatísticas" showLogout><div className="flex justify-center mt-8"><Spinner size="lg" /></div></AppShell>;
    }
    if (!stats) {
         return <AppShell title="Estatísticas" showLogout><Alert type="info" message="Nenhuma estatística disponível."/></AppShell>;
    }

    return (
        <AppShell title="Estatísticas de Entregas" showLogout>
            <div className="space-y-8">
                <section>
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Desempenho Geral</h3>
                    <div className="p-4 bg-gray-50 rounded-md shadow">
                        <p>Taxa de Sucesso: <strong className="text-green-600">{stats.performance.rate.toFixed(1)}%</strong></p>
                        <p>Entregas Concluídas: {stats.performance.delivered}</p>
                        <p>Total Considerado (Concluídas/Canceladas/Pendentes): {stats.performance.total}</p>
                    </div>
                </section>

                <section>
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Entregas por Status</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {Object.entries(stats.byStatus).map(([status, count]) => (
                            <div key={status} className="p-4 bg-blue-50 rounded-md text-center shadow">
                                <p className="text-sm capitalize text-blue-700">{status.replace('_', ' ')}</p>
                                <p className="text-2xl font-bold text-blue-900">{count}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Top Bairros (Entregas Concluídas)</h3>
                    {stats.byBairro.length > 0 ? (
                        <ul className="space-y-1 max-h-48 overflow-y-auto bg-white p-3 rounded-md shadow">
                            {stats.byBairro.slice(0, 10).map(item => (
                                <li key={item.bairro} className="flex justify-between text-sm">
                                    <span>{item.bairro}</span>
                                    <strong>{item.count}</strong>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-sm text-gray-500">Nenhuma entrega concluída com bairro registrado.</p>}
                </section>
                
                <section>
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Entregas Concluídas por Dia</h3>
                     {stats.byDay.length > 0 ? (
                        <div className="bg-white p-3 rounded-md shadow max-h-60 overflow-y-auto">
                            {/* Simple list for now, charting can be added later */}
                            {stats.byDay.map(item => (
                                <div key={item.date} className="flex justify-between text-sm py-1 border-b last:border-b-0">
                                    <span>{new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                                    <strong>{item.count} entregas</strong>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-sm text-gray-500">Nenhuma entrega concluída registrada.</p>}
                </section>
            </div>
        </AppShell>
    );
};

const HowToUsePage: React.FC = () => {
    // Placeholder text - replace with actual instructions from "print final enviado"
    const instructions = `
Bem-vindo ao RotaSpeed!

1.  **Login/Cadastro:** Acesse sua conta ou crie uma nova. Novos usuários ganham 10 entregas grátis!
2.  **Configurar Entregas:** Informe quantos pacotes você irá entregar hoje.
3.  **Adicionar Pacotes:**
    *   **Texto:** Digite ou cole os endereços.
    *   **Arquivo:** Envie uma foto de etiqueta, PDF ou planilha.
    *   **Câmera:** Tire uma foto da etiqueta diretamente.
    *   **Voz:** Dite os endereços.
4.  **Otimizar Rota:**
    *   **Automática:** Deixe nossa IA encontrar a melhor rota (requer permissão de localização ou endereço de partida manual).
    *   **Manual:** Organize as paradas na ordem que preferir.
5.  **Realizar Entregas:**
    *   Clique em "Navegar" para abrir o endereço no seu app de mapas preferido (Google Maps, Waze, etc. - configure em Configurações).
    *   Marque como "Entregue" ou "Cancelada".
    *   Notifique clientes via WhatsApp (se o telefone estiver disponível).
    *   Compartilhe links da rota.
6.  **Concluído:** Ao finalizar todas as entregas, inicie uma nova rota!
7.  **Configurações:** Personalize seu nome, nome de entregador, telefone para notificações e app de navegação padrão.
8.  **Estatísticas:** Acompanhe seu desempenho, veja entregas por status, bairro e dia.
9.  **Planos:** Precisando de mais entregas? Confira nossos planos e créditos de voz em "Planos e Créditos".

Dúvidas? Contate o suporte. Boas entregas!
    `;

    return (
        <AppShell title="Como Usar o RotaSpeed" showLogout>
            <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none p-2 bg-gray-50 rounded-md">
                {instructions.split('\n\n').map((paragraph, index) => (
                    <div key={index} className="mb-4">
                        {paragraph.split('\n').map((line, lineIndex) => {
                            if (line.match(/^\d+\.\s\*\*.+\*\*$/)) { // Matches "1.  **Title:**"
                                return <h3 key={lineIndex} className="font-semibold text-gray-700 mt-3 mb-1">{line.replace(/^\d+\.\s\*\*(.+)\*\*$/, '$1')}</h3>;
                            }
                            if (line.match(/^\s*\*\s.+/)) { // Matches "*   Item"
                                 return <p key={lineIndex} className="ml-4 text-gray-600">{line.replace(/^\s*\*\s/, '• ')}</p>;
                            }
                            return <p key={lineIndex} className="text-gray-600">{line}</p>;
                        })}
                    </div>
                ))}
            </div>
        </AppShell>
    );
};


// AppShell remains largely the same but might need links to new pages
const AppShell: React.FC<{ title: string; children: React.ReactNode; showLogout?: boolean }> = ({ title, children, showLogout }) => {
  const { state, dispatch } = useSharedState();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showUserInfoDropdown, setShowUserInfoDropdown] = useState(false);
  const userInfoRef = useRef<HTMLDivElement>(null);


  const handleLogout = async () => {
    dispatch({ type: 'SET_IS_AUTHENTICATING', payload: true });
    const { error } = await supabase.auth.signOut();
    if (error) {
        dispatch({type: 'SET_ERROR_MESSAGE', payload: 'Erro ao sair. Tente novamente.'});
    }
    // LOGOUT action dispatched by onAuthStateChange
    navigate('/'); 
  };

  const clearMessages = () => {
    dispatch({ type: 'SET_ERROR_MESSAGE', payload: null });
    dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: null });
    dispatch({ type: 'SET_INFO_MESSAGE', payload: null });
  };

  const commonNavClasses = "block px-3 py-2 rounded-md text-base font-medium hover:bg-blue-700";
  const activeNavClasses = "bg-blue-700 text-white";
  const inactiveNavClasses = "text-blue-100 hover:text-white";
  
  const NavLinkItem: React.FC<{to: string; children: React.ReactNode; onClick?: () => void}> = ({to, children, onClick}) => {
    const location = useLocation();
    const isActive = location.pathname === to;
    return (
        <Link 
            to={to} 
            className={`${commonNavClasses} ${isActive ? activeNavClasses : inactiveNavClasses}`}
            onClick={() => { setMenuOpen(false); if(onClick) onClick();}}
        >
            {children}
        </Link>
    );
  }

   useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userInfoRef.current && !userInfoRef.current.contains(event.target as Node)) {
        setShowUserInfoDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans">
      <header className="bg-blue-600 text-white shadow-md sticky top-0 z-40">
        <div className="container mx-auto flex justify-between items-center max-w-4xl px-4 h-16">
          <Link to={state.user ? "/app/package-setup" : "/"} className="flex items-center space-x-2 hover:opacity-90">
            <PackageIcon className="w-8 h-8"/>
            <h1 className="text-2xl font-semibold">RotaSpeed</h1>
          </Link>
          
          {/* Desktop User Info & Menu */}
          {state.user && (
            <div className="hidden sm:flex items-center space-x-2">
                <div ref={userInfoRef} className="relative">
                    <button 
                        onClick={() => setShowUserInfoDropdown(!showUserInfoDropdown)}
                        className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-blue-700 focus:outline-none"
                        aria-label="Informações do usuário e menu"
                        aria-haspopup="true"
                        aria-expanded={showUserInfoDropdown}
                    >
                        <UserIcon className="w-5 h-5" />
                        <span className="text-sm font-medium">{state.user.nome || state.user.driver_name || state.user.email?.split('@')[0]}</span>
                        <svg className={`w-4 h-4 transition-transform duration-200 ${showUserInfoDropdown ? 'transform rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>
                    </button>
                    {showUserInfoDropdown && (
                        <div className="absolute right-0 mt-2 w-64 bg-white rounded-md shadow-xl z-50 py-1 text-gray-700">
                            <div className="px-4 py-2 border-b">
                                <p className="text-sm font-semibold">{state.user.nome || state.user.driver_name}</p>
                                <p className="text-xs text-gray-500">{state.user.email}</p>
                                <p className="text-xs text-gray-500 mt-1">Plano: <span className="font-medium">{state.user.plano_nome}</span></p>
                                <p className="text-xs text-gray-500">Hoje: {state.user.entregas_hoje}/{state.user.entregas_dia_max} entregas</p>
                                <p className="text-xs text-gray-500">Créditos Voz: {state.user.saldo_creditos}</p>
                            </div>
                            <Link to="/app/settings" className="block px-4 py-2 text-sm hover:bg-gray-100" onClick={() => setShowUserInfoDropdown(false)}>Configurações</Link>
                            <Link to="/app/statistics" className="block px-4 py-2 text-sm hover:bg-gray-100" onClick={() => setShowUserInfoDropdown(false)}>Estatísticas</Link>
                            <Link to="/app/subscription-info" className="block px-4 py-2 text-sm hover:bg-gray-100" onClick={() => setShowUserInfoDropdown(false)}>Planos e Créditos</Link>
                            <Link to="/app/how-to-use" className="block px-4 py-2 text-sm hover:bg-gray-100" onClick={() => setShowUserInfoDropdown(false)}>Como Usar</Link>
                            {showLogout && (
                                <button 
                                    onClick={() => {setShowUserInfoDropdown(false); handleLogout();}} 
                                    className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 text-red-600"
                                >
                                    Sair
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
          )}

          {/* Mobile Menu Button */}
           {state.user && (
            <div className="sm:hidden">
                <Button variant="ghost" size="sm" className="text-white hover:bg-blue-700 p-2" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu" aria-expanded={menuOpen} aria-controls="mobile-menu">
                    <Bars3Icon className="w-6 h-6"/>
                </Button>
            </div>
           )}
        </div>
        {/* Mobile Menu Panel */}
        {menuOpen && state.user && (
            <div id="mobile-menu" className="sm:hidden absolute top-16 inset-x-0 bg-blue-600 p-2 space-y-1 shadow-lg z-30">
                <div className="px-3 py-2 border-b border-blue-500 mb-2">
                    <p className="text-base font-medium text-white">{state.user.nome || state.user.driver_name}</p>
                    <p className="text-sm text-blue-200">{state.user.email}</p>
                    <p className="text-xs text-blue-200">Plano: {state.user.plano_nome} | Hoje: {state.user.entregas_hoje}/{state.user.entregas_dia_max} | Créditos: {state.user.saldo_creditos}</p>
                </div>
                <NavLinkItem to="/app/package-setup">Nova Rota</NavLinkItem>
                <NavLinkItem to="/app/settings">Configurações</NavLinkItem>
                <NavLinkItem to="/app/statistics">Estatísticas</NavLinkItem>
                <NavLinkItem to="/app/subscription-info">Planos e Créditos</NavLinkItem>
                <NavLinkItem to="/app/how-to-use">Como Usar</NavLinkItem>
                {showLogout && <button onClick={()=>{setMenuOpen(false); handleLogout();}} className={`${commonNavClasses} ${inactiveNavClasses} w-full text-left`}>Sair</button>}
            </div>
        )}
      </header>
      <main className="flex-grow container mx-auto p-4 md:p-6 max-w-4xl w-full">
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-lg">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4 sm:mb-6 border-b pb-3">{title}</h2>
            {state.errorMessage && <Alert type="error" message={state.errorMessage} onClose={clearMessages} />}
            {state.successMessage && <Alert type="success" message={state.successMessage} onClose={clearMessages} />}
            {state.infoMessage && <Alert type="info" message={state.infoMessage} onClose={clearMessages} />}
            {(state.isLoading && state.phase !== AppPhase.PACKAGE_INPUT && state.phase !== AppPhase.DELIVERY && !state.isFetchingLocation) &&
              <div className="my-4 flex flex-col items-center"><Spinner className="mx-auto" /><p className="text-sm text-gray-500 mt-1">Carregando...</p></div>}
            {children}
        </div>
      </main>       <footer className="text-center p-4 text-sm text-gray-500">
        © {new Date().getFullYear()} RotaSpeed. Todos os direitos reservados.
      </footer>
    </div>
  );
};

const ProtectedRoute: React.FC<{ children: React.ReactNode; targetPhase?: AppPhase | AppPhase[] }> = ({ children, targetPhase }) => {
  const { state } = useSharedState();
  const location = useLocation();

  if (state.isAuthenticating) {
     return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
            <Spinner size="lg" />
            <p className="text-gray-600 mt-4">{state.infoMessage ||'Carregando...'}</p>
        </div>
    );
  }

  if (!state.user) {
    const allowedPublicPaths = ['/', '/reset-password'];
    return allowedPublicPaths.includes(location.pathname) ? <>{children}</> : <Navigate to="/" replace state={{ from: location }} />;
  }
  
  const allowedAppPhasesWhenPlanInactive = [AppPhase.SUBSCRIPTION_INFO, AppPhase.PLAN_EXPIRED, AppPhase.SETTINGS, AppPhase.HOW_TO_USE, AppPhase.STATISTICS]; // Allow some pages even if plan inactive
  if (!state.user.plano_ativo && !allowedAppPhasesWhenPlanInactive.includes(state.phase) && 
      location.pathname !== '/app/subscription-info' && 
      location.pathname !== '/app/settings' && 
      location.pathname !== '/app/how-to-use' && 
      location.pathname !== '/app/statistics' 
  ) {
      if (state.phase !== AppPhase.LOGIN && state.phase !== AppPhase.PLAN_EXPIRED) { 
        return <Navigate to="/app/subscription-info" replace state={{ from: location, message: "Seu plano está inativo." }} />;
      }
  }
    
  if (state.phase === AppPhase.LIMIT_REACHED && 
      location.pathname !== '/app/subscription-info' &&
      location.pathname !== '/app/settings' && 
      location.pathname !== '/app/how-to-use' &&
      location.pathname !== '/app/statistics' &&
      location.pathname !== '/app/delivery' && 
      location.pathname !== '/app/manual-ordering'
    ) {
      // If trying to start a new route when limit reached, redirect to subscription or show message.
      // This is partially handled by individual pages too.
      if (location.pathname === '/app/package-setup' || location.pathname === '/app/package-input') {
         return <Navigate to="/app/subscription-info" replace state={{ from: location, message: "Limite de entregas atingido."}} />;
      }
  }


  const targetPhasesArray = targetPhase ? (Array.isArray(targetPhase) ? targetPhase : [targetPhase]) : null;

  if (targetPhasesArray && !targetPhasesArray.includes(state.phase)) {
    const alwaysAllowedPathsForLoggedInUser = ['/app/subscription-info', '/app/settings', '/app/statistics', '/app/how-to-use'];
    if (alwaysAllowedPathsForLoggedInUser.includes(location.pathname)) {
        return <>{children}</>;
    }

    if (state.phase === AppPhase.PLAN_EXPIRED && !alwaysAllowedPathsForLoggedInUser.includes(location.pathname)) {
        return <Navigate to="/app/subscription-info" replace state={{ from: location }} />;
    }

    let redirectTo = "/app/package-setup"; // Default for authenticated user
    if (state.user) { 
        switch (state.phase) {
            case AppPhase.LOGIN: redirectTo = "/"; break;
            case AppPhase.RESET_PASSWORD: redirectTo = "/reset-password"; break;
            case AppPhase.PACKAGE_COUNT_SETUP: redirectTo = "/app/package-setup"; break;
            case AppPhase.PACKAGE_INPUT: redirectTo = "/app/package-input"; break;
            case AppPhase.MANUAL_ORDERING: redirectTo = "/app/manual-ordering"; break;
            case AppPhase.DELIVERY: redirectTo = "/app/delivery"; break;
            case AppPhase.COMPLETED: redirectTo = "/app/completed"; break;
            case AppPhase.SUBSCRIPTION_INFO: redirectTo = "/app/subscription-info"; break;
            case AppPhase.SETTINGS: redirectTo = "/app/settings"; break;
            case AppPhase.STATISTICS: redirectTo = "/app/statistics"; break;
            case AppPhase.HOW_TO_USE: redirectTo = "/app/how-to-use"; break;
            case AppPhase.PLAN_EXPIRED: redirectTo = "/app/subscription-info"; break;
            case AppPhase.LIMIT_REACHED: 
                if (location.pathname === '/app/package-setup' || location.pathname === '/app/package-input') {
                    redirectTo = "/app/subscription-info"; // Or stay and show message, current setup has modals.
                } else {
                    // Allow staying on current page if it's delivery or manual ordering to see the limit message.
                    redirectTo = location.pathname; 
                }
                break;
            default: redirectTo = "/app/package-setup"; 
        }
    }
    
    // Avoid redirect loop if current path is already the intended redirect path for the current phase
    // or if targetPhase allows login/reset (which are public and handled by !state.user check)
    if (location.pathname !== redirectTo && 
        !targetPhasesArray.includes(AppPhase.LOGIN) && 
        !targetPhasesArray.includes(AppPhase.RESET_PASSWORD) ) { 
        // Check if the targetPhase actually includes the current state.phase. If not, redirect.
        // This check is a bit complex due to multiple allowed phases for some routes.
        // The main idea is: if this route is for a specific phase (targetPhase) and the app is not in that phase,
        // redirect to where the app *thinks* it should be (redirectTo derived from state.phase).
        return <Navigate to={redirectTo} replace state={{ from: location }} />;
    }
  }

  return <>{children}</>;
};


const AppRoutes: React.FC = () => {
  const { state } = useSharedState();

  return (
    <Routes>
      <Route 
        path="/" 
        element={
          state.user && !state.isAuthenticating 
            ? <Navigate to="/app/package-setup" replace /> 
            : <LoginPage />
        } 
      />
      <Route path="/reset-password" element={<ResetPasswordPage />} /> 
      
      <Route path="/app/package-setup" element={<ProtectedRoute targetPhase={[AppPhase.PACKAGE_COUNT_SETUP, AppPhase.PLAN_EXPIRED, AppPhase.LIMIT_REACHED]}><PackageSetupPage /></ProtectedRoute>} />
      <Route path="/app/package-input" element={<ProtectedRoute targetPhase={[AppPhase.PACKAGE_INPUT, AppPhase.PLAN_EXPIRED, AppPhase.LIMIT_REACHED]}><PackageInputPage /></ProtectedRoute>} />
      <Route path="/app/manual-ordering" element={<ProtectedRoute targetPhase={[AppPhase.MANUAL_ORDERING, AppPhase.LIMIT_REACHED, AppPhase.PLAN_EXPIRED]}><ManualOrderingPage /></ProtectedRoute>} />
      <Route path="/app/delivery" element={<ProtectedRoute targetPhase={[AppPhase.DELIVERY, AppPhase.LIMIT_REACHED, AppPhase.PLAN_EXPIRED]}><DeliveryPage /></ProtectedRoute>} />
      <Route path="/app/completed" element={<ProtectedRoute targetPhase={AppPhase.COMPLETED}><CompletedPage /></ProtectedRoute>} />
      
      <Route 
        path="/app/subscription-info" 
        element={<ProtectedRoute><SubscriptionInfoPage /></ProtectedRoute>} 
      />
       <Route 
        path="/app/settings" 
        element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} 
      />
       <Route 
        path="/app/statistics" 
        element={<ProtectedRoute><StatisticsPage /></ProtectedRoute>} 
      />
       <Route 
        path="/app/how-to-use" 
        element={<ProtectedRoute><HowToUsePage /></ProtectedRoute>} 
      />

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}


const App: React.FC = () => {
  return (
    <AppContextProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AppContextProvider>
  );
};

export default App;
