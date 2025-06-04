
import React, { useEffect, useReducer, createContext, useContext, useState, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import type { AppState, AppAction, User, PackageInfo, AddressInfo, RouteStop, ParsedAddressFromAI, UserCoordinates, EntregaDbRecord } from './types';
import { AppPhase, InputType } from './types';
import { Button, Input, Modal, Spinner, Textarea, Alert, UserIcon, LockClosedIcon, PackageIcon, CameraIcon, MicrophoneIcon, DocumentTextIcon, UploadIcon, MapPinIcon, CheckCircleIcon, XCircleIcon, TrashIcon, ArrowPathIcon, PaperAirplaneIcon, WhatsAppIcon, InformationCircleIcon, RadioGroup, ListBulletIcon, Bars3Icon, ArrowUpIcon, ArrowDownIcon, ExclamationTriangleIcon, ShareIcon, CreditCardIcon, CloseIcon, Cog6ToothIcon, ChartBarIcon, QuestionMarkCircleIcon } from './uiComponents';
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
      return { 
        ...state, 
        optimizedRoute: action.payload, 
        phase: nextPhase, 
        currentStopIndex: 0, 
        showNotifyAllModal: action.isNewOptimization === true && nextPhase === AppPhase.DELIVERY ? true : false 
      };
    }
    case 'SET_MANUALLY_ORDERED_PACKAGES': {
        const manuallyOrderedRouteStops: RouteStop[] = action.payload.map((pkg, index) => ({
            ...pkg,
            order: index + 1,
            // status: 'pending', // Status should be 'in_transit' or similar, handled by calling logic if needed
        }));
        let nextPhase = AppPhase.DELIVERY;
        if (state.user && !state.user.plano_ativo) {
            nextPhase = AppPhase.PLAN_EXPIRED;
        } else if (state.user && state.user.plano_nome === 'Grátis' && state.user.entregas_gratis_utilizadas >= state.user.entregas_dia_max) {
            nextPhase = AppPhase.LIMIT_REACHED;
        } else if (state.user && state.user.plano_nome !== 'Grátis' && state.user.entregas_hoje >= state.user.entregas_dia_max) {
            nextPhase = AppPhase.LIMIT_REACHED;
        }
        return { 
            ...state, 
            optimizedRoute: manuallyOrderedRouteStops, 
            phase: nextPhase, 
            currentStopIndex: 0, 
            showNotifyAllModal: action.isNewOptimization === true && nextPhase === AppPhase.DELIVERY ? true : false 
        };
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
    case 'UPDATE_USER_PROFILE_SILENT':
      if (!state.user) return state; // Should not happen if user is defined for silent update
      return {
        ...state,
        user: {
          ...state.user,
          ...action.payload,
        }
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
const getAppRootUrl = (dispatch?: React.Dispatch<AppAction>): string => {
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
         dispatch({ type: 'SET_OPTIMIZED_ROUTE', payload: currentRoutePackages, isNewOptimization: false }); // Not a new optimization
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
                // dispatch({ type: 'LOGIN_SUCCESS', payload: profile }); // This also clears packages and route locally.
                dispatch({ type: 'UPDATE_USER_PROFILE_SILENT', payload: profile }); // Only updates user object
                // If LOGIN_SUCCESS was also fetching deliveries, that part needs to be considered.
                // For a silent update, we might not want to re-fetch all deliveries unless explicitly needed by a change.
                // However, if entregas_hoje changes, the display in PackageSetupPage needs it, so profile update is good.
                // If packages/route were cleared by LOGIN_SUCCESS, and we don't want that,
                // then UPDATE_USER_PROFILE_SILENT is correct. We might need to selectively re-fetch
                // 'entregas' if a change in 'profile' implies they might be stale,
                // but for now, just updating user object is the goal.
                // await fetchUserEntregas(profile.id); // This line was part of LOGIN_SUCCESS logic, re-evaluate if needed here
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
      
      // Generate a UUID for the route_id
      currentRouteIdRef.current = crypto.randomUUID();

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

      dispatch({ type: 'SET_OPTIMIZED_ROUTE', payload: routeStops, isNewOptimization: true });
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
            currentRouteIdRef.current = crypto.randomUUID(); // Generate UUID for manual route
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
            currentRouteIdRef.current = crypto.randomUUID(); // Generate UUID for the route_id
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
            const payloadForDispatch = orderedPackages.map((pkg,index) => ({...pkg, order: index + 1, status: 'in_transit' as PackageInfo['status'], route_id: currentRouteIdRef.current!}));
            dispatch({ type: 'SET_MANUALLY_ORDERED_PACKAGES', payload: payloadForDispatch, isNewOptimization: true });
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

  if (state.phase === AppPhase.COMPLETED ) { // Simplified: only check for COMPLETED phase for this specific redirect.
      return <Navigate to="/app/completed" replace />;
  }
  
  // If phase is DELIVERY but route is empty (and not loading), redirect. (Covered by useEffect)
  // If phase is DELIVERY and route has items, but currentPackage is undefined, redirect.
  if (state.phase === AppPhase.DELIVERY && state.optimizedRoute.length > 0 && !currentPackage) {
      console.error("DeliveryPage: In DELIVERY phase with a route, but currentPackage is undefined. Route or index issue. Redirecting to package input.");
      // Dispatching an error might be good here.
      // dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Erro ao carregar a parada atual da rota.' });
      return <Navigate to="/app/package-input" replace />;
  }
  
  // Handle cases where currentPackage is null, but we might be in a modal state (LIMIT_REACHED, PLAN_EXPIRED)
  // or if phase is DELIVERY and route is truly empty (and not loading), which useEffect should also catch.
  if (!currentPackage && state.phase === AppPhase.DELIVERY && !state.isLoading) {
      // This case suggests route is empty. useEffect should navigate.
      // Showing a loading or message here can prevent flash of content if useEffect is slightly delayed.
      return <AppShell title="Carregando Entrega..." showLogout><div className="p-4 text-center"><Spinner /><p>Preparando rota...</p></div></AppShell>;
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

    const routeLinksTextArray = pendingStops.map((stop) => {
        const addressParts = [stop.street, stop.number, stop.bairro, stop.city, stop.state, stop.cep].filter(Boolean).join(', ');
        const fullAddressForMap = addressParts || stop.fullAddress.replace(stop.complemento || '', '').replace(stop.telefone || '', '').trim();
        const encodedAddress = encodeURIComponent(fullAddressForMap);
        return `${stop.order}. ${stop.fullAddress} (Dest.: ${stop.recipientName || 'N/A'}): https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
    });
    const completeRouteTextForSharing = routeLinksTextArray.join('\n');

    try {
        if (navigator.share) {
            await navigator.share({
                title: 'Minha Rota de Entregas - RotaSpeed',
                text: `Aqui está minha rota de entregas para hoje:\n\n${completeRouteTextForSharing}`,
                // url: getAppRootUrl(dispatch) // dispatch is not available here directly, would need to be passed or use context
            });
            dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Rota compartilhada com sucesso!' });
        } else {
            // Fallback for browsers that don't support navigator.share
            await navigator.clipboard.writeText(`Minha Rota de Entregas - RotaSpeed:\n\n${completeRouteTextForSharing}`);
            dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: 'Links da rota copiados para a área de transferência!' });
        }
    } catch (error) {
        console.error('Error sharing route:', error);
        dispatch({ type: 'SET_ERROR_MESSAGE', payload: 'Erro ao compartilhar a rota. Tente copiar manualmente.' });
    }
  };

  return (
    <AppShell title={`Entrega (${currentPackage ? state.currentStopIndex + 1 : 'N/A'}/${state.optimizedRoute.length}) - ${remainingDeliveries} Restantes`} showLogout>
      {/* Show this if phase is LIMIT_REACHED or PLAN_EXPIRED (modals from AppShell will overlay) OR if currentPackage is genuinely not ready */}
      {!currentPackage && (state.phase === AppPhase.LIMIT_REACHED || state.phase === AppPhase.PLAN_EXPIRED) && !state.isLoading && (
        <div className="p-4 text-center">
            {/* Specific messages for these states are handled by modals in AppShell */}
            <p className="my-4 text-gray-600">Verifique as notificações sobre seu plano ou limite de entregas.</p>
            <Spinner />
        </div>
      )}

      {currentPackage && state.phase === AppPhase.DELIVERY && (
        <div className="p-4 space-y-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-blue-700 mb-1">Próxima Parada ({currentPackage.order}/{state.optimizedRoute.length}):</h3>
            <p className="text-xl font-bold text-gray-800">{currentPackage.fullAddress}</p>
            {currentPackage.recipientName && <p className="text-sm text-gray-600">Destinatário: {currentPackage.recipientName}</p>}
            {currentPackage.telefone && <p className="text-sm text-gray-600">Telefone: {currentPackage.telefone}</p>}
            {currentPackage.bairro && <p className="text-sm text-gray-500">Bairro: {currentPackage.bairro}</p>}
            {currentPackage.complemento && <p className="text-sm text-gray-500">Complemento: {currentPackage.complemento}</p>}
            {currentPackage.delivery_notes && <p className="text-sm text-yellow-700 bg-yellow-50 p-2 rounded mt-1">Nota: {currentPackage.delivery_notes}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button onClick={openNavigationApp} variant="primary" size="lg" className="w-full">
              <MapPinIcon className="mr-2"/> Abrir no Mapa
            </Button>
            <Button onClick={() => handleUpdatePackageStatus('entregue')} variant="secondary" size="lg" className="w-full bg-green-500 hover:bg-green-600 text-white" isLoading={state.isLoading}>
              <CheckCircleIcon className="mr-2"/> Marcar como Entregue
            </Button>
            <Button onClick={() => handleUpdatePackageStatus('cancelada')} variant="secondary" size="lg" className="w-full bg-red-500 hover:bg-red-600 text-white" isLoading={state.isLoading}>
              <XCircleIcon className="mr-2"/> Marcar como Cancelada
            </Button>
            <Button 
                onClick={() => handleSimulateIndividualNotification(currentPackage)} 
                variant="secondary" 
                size="lg" 
                className="w-full" 
                disabled={!currentPackage.telefone}
                title={!currentPackage.telefone ? "Sem telefone cadastrado para notificar" : "Notificar cliente individualmente"}
            >
              <WhatsAppIcon className="mr-2"/> Notificar Cliente
            </Button>
          </div>
           <Button onClick={handleShareRouteLinks} variant="ghost" size="md" className="w-full text-blue-600 mt-4">
                <ShareIcon className="mr-2" /> Compartilhar Links da Rota
            </Button>
        </div>
      )}
      
      <Modal
        isOpen={state.showNotifyAllModal && state.phase === AppPhase.DELIVERY }
        onClose={() => handleNotifyAllConfirmation(false)}
        title="Notificar Clientes?"
      >
        <p className="text-gray-700 mb-4">Deseja notificar todos os clientes pendentes sobre as entregas via WhatsApp?</p>
        {state.user?.notification_sender_preference === 'driver' && !state.user?.driver_phone &&
            <Alert type="warning" message="Seu telefone de motorista não está configurado nas Configurações. As mensagens podem não ser enviadas corretamente ou usar um número padrão do sistema (se configurado)." />
        }
        <div className="flex justify-end space-x-3">
            <Button variant="ghost" onClick={() => handleNotifyAllConfirmation(false)}>Não, obrigado</Button>
            <Button variant="primary" onClick={() => handleNotifyAllConfirmation(true)}>Sim, Notificar Todos</Button>
        </div>
      </Modal>

      <Modal
        isOpen={showIndividualNotificationModal}
        onClose={() => {
            setShowIndividualNotificationModal(false);
            setSelectedPackageForNotification(null);
        }}
        title={`Notificar ${selectedPackageForNotification?.recipientName || 'Cliente'}`}
      >
        {selectedPackageForNotification && state.user && (
            <div>
                <p className="mb-4 text-sm text-gray-600">Você está prestes a enviar uma notificação via WhatsApp para <span className="font-semibold">{selectedPackageForNotification.recipientName || "este cliente"}</span> ({selectedPackageForNotification.telefone}).</p>
                {state.user.notification_sender_preference === 'driver' && !state.user.driver_phone &&
                    <Alert type="warning" message="Seu telefone de motorista não está configurado. A mensagem pode não ser enviada corretamente." />
                }
                <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                        const driverName = state.user?.driver_name || "Seu entregador";
                        const message = `Olá ${selectedPackageForNotification.recipientName || 'Cliente'}, ${driverName} da RotaSpeed está a caminho com sua entrega! Endereço: ${selectedPackageForNotification.fullAddress}.`;
                        const cleanedPhone = selectedPackageForNotification.telefone?.replace(/\D/g, '');
                        let fullPhoneNumber = cleanedPhone;
                         if (cleanedPhone && !cleanedPhone.startsWith('55') && (cleanedPhone.length === 10 || cleanedPhone.length === 11)) {
                            fullPhoneNumber = '55' + cleanedPhone;
                        }
                        const whatsappUrl = `https://wa.me/${fullPhoneNumber}?text=${encodeURIComponent(message)}`;
                        window.open(whatsappUrl, '_blank');
                        dispatch({type: 'SET_SUCCESS_MESSAGE', payload: 'Link do WhatsApp aberto para notificação.'});
                        setShowIndividualNotificationModal(false);
                        setSelectedPackageForNotification(null);
                    }}
                >
                    <WhatsAppIcon className="mr-2"/> Abrir WhatsApp
                </Button>
            </div>
        )}
      </Modal>
    </AppShell>
  );
};

const CompletedPage: React.FC = () => {
  const { state, dispatch } = useSharedState();
  const navigate = useNavigate();
  return (
    <AppShell title="Entregas Concluídas" showLogout>
      <div className="p-4 text-center">
        <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Rota Finalizada!</h2>
        <p className="text-gray-700 mb-6">Parabéns, você concluiu todas as suas entregas para esta rota.</p>
        <div className="space-y-3">
          <Button onClick={() => { dispatch({ type: 'CLEAR_PACKAGES_AND_ROUTE' }); navigate('/app/package-setup');}} variant="primary" size="lg" className="w-full max-w-xs mx-auto">
            Iniciar Nova Rota
          </Button>
          <Button onClick={() => navigate('/app/statistics')} variant="secondary" size="lg" className="w-full max-w-xs mx-auto">
            Ver Estatísticas
          </Button>
        </div>
      </div>
    </AppShell>
  );
};

const SubscriptionInfoPage: React.FC = () => {
    const { state } = useSharedState();
    return (
        <AppShell title="Informações do Plano" showLogout showBackButton>
            <div className="p-6 bg-white rounded-lg shadow-lg max-w-2xl mx-auto">
                <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Seu Plano RotaSpeed</h2>
                
                {state.user && (
                    <div className="mb-8 p-6 bg-blue-50 rounded-xl border border-blue-200">
                        <div className="flex items-center mb-4">
                            <CreditCardIcon className="w-8 h-8 text-blue-600 mr-3" />
                            <h3 className="text-xl font-semibold text-blue-700">Plano Atual: {state.user.plano_nome}</h3>
                        </div>
                        <div className="space-y-2 text-gray-700">
                            <p><strong className="font-medium">Status:</strong> <span className={state.user.plano_ativo ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>{state.user.plano_ativo ? 'Ativo' : 'Inativo'}</span></p>
                            <p><strong className="font-medium">Limite Diário de Entregas:</strong> {state.user.entregas_dia_max}</p>
                            <p><strong className="font-medium">Entregas Realizadas Hoje:</strong> {state.user.entregas_hoje}</p>
                            {state.user.plano_nome === 'Grátis' && (
                                <p><strong className="font-medium">Entregas Grátis Utilizadas (Total):</strong> {state.user.entregas_gratis_utilizadas} de {state.user.entregas_dia_max}</p>
                            )}
                            <p><strong className="font-medium">Créditos de Voz:</strong> {state.user.saldo_creditos}</p>
                        </div>
                    </div>
                )}

                <div className="text-center mb-8">
                    <h3 className="text-xl font-semibold text-gray-700 mb-2">Precisa de mais?</h3>
                    <p className="text-gray-600">Considere um upgrade para otimizar mais entregas e acessar recursos premium!</p>
                </div>

                {/* Placeholder for plan options - In a real app, these would be dynamic */}
                <div className="grid md:grid-cols-2 gap-6">
                    <div className="p-6 border border-gray-200 rounded-lg hover:shadow-xl transition-shadow bg-white">
                        <h4 className="text-lg font-bold text-blue-600 mb-2">Plano Pro</h4>
                        <p className="text-gray-600 text-sm mb-3">Ideal para entregadores com alto volume.</p>
                        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1 mb-4">
                            <li>100 Entregas/Dia</li>
                            <li>Suporte Prioritário</li>
                            <li>Créditos de Voz Mensais</li>
                        </ul>
                        <Button variant="primary" className="w-full" onClick={() => alert('Upgrade para Pro - Funcionalidade em desenvolvimento!')}>Fazer Upgrade</Button>
                    </div>
                    <div className="p-6 border border-gray-200 rounded-lg hover:shadow-xl transition-shadow bg-white">
                        <h4 className="text-lg font-bold text-purple-600 mb-2">Plano Business</h4>
                        <p className="text-gray-600 text-sm mb-3">Para pequenas frotas e negócios.</p>
                         <ul className="list-disc list-inside text-sm text-gray-600 space-y-1 mb-4">
                            <li>500 Entregas/Dia</li>
                            <li>Multi-usuário (em breve)</li>
                            <li>API de Integração (em breve)</li>
                        </ul>
                        <Button style={{backgroundColor: '#6d28d9', borderColor: '#6d28d9'}} className="w-full text-white hover:bg-purple-700" onClick={() => alert('Upgrade para Business - Funcionalidade em desenvolvimento!')}>Contate-nos</Button>
                    </div>
                </div>
                <p className="text-center text-xs text-gray-500 mt-8">
                    Para cancelamentos ou dúvidas sobre sua assinatura, entre em contato com o suporte.
                </p>
            </div>
        </AppShell>
    );
};

const SettingsPage: React.FC = () => {
    const { state, dispatch } = useSharedState();
    const [nome, setNome] = useState(state.user?.nome || '');
    const [driverName, setDriverName] = useState(state.user?.driver_name || '');
    const [driverPhone, setDriverPhone] = useState(state.user?.driver_phone || '');
    const [navPreference, setNavPreference] = useState(state.user?.navigation_preference || 'google');
    const [notificationSender, setNotificationSender] = useState(state.user?.notification_sender_preference || 'driver');

    const handleSave = async () => {
        if (!state.user) return;
        dispatch({type: 'SET_LOADING', payload: true});
        const settingsToUpdate: Partial<User> = {
            nome: nome || null, // Allow setting nome to null if cleared
            driver_name: driverName || null,
            driver_phone: driverPhone || null,
            navigation_preference: navPreference,
            notification_sender_preference: notificationSender,
        };
        try {
            const updatedUser = await updateUserProfileSettings(state.user.id, settingsToUpdate);
            if (updatedUser) {
                dispatch({type: 'UPDATE_USER_SETTINGS_SUCCESS', payload: updatedUser });
                dispatch({type: 'SET_SUCCESS_MESSAGE', payload: 'Configurações salvas com sucesso!'});
            }
        } catch (error: any) {
            dispatch({type: 'SET_ERROR_MESSAGE', payload: `Erro ao salvar: ${error.message}`});
        } finally {
            dispatch({type: 'SET_LOADING', payload: false});
        }
    };
    const navOptions = [
        {value: 'google', label: 'Google Maps'},
        {value: 'waze', label: 'Waze'},
        {value: 'apple', label: 'Apple Maps (iOS)'},
    ];
    const senderOptions = [
        {value: 'driver', label: 'Meu Número (Celular do Entregador)'},
        {value: 'system', label: 'Número do Sistema (RotaSpeed)'},
    ];

    return (
        <AppShell title="Configurações do Usuário" showLogout showBackButton>
            <div className="p-4 max-w-lg mx-auto bg-white rounded-lg shadow space-y-6">
                <h2 className="text-xl font-semibold text-gray-700 border-b pb-2">Perfil</h2>
                <Input label="Seu Nome (para exibição)" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: João Silva" />
                <Input label="Nome do Entregador (para notificações)" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Ex: João Entregas" />
                <Input label="Seu WhatsApp (para notificações 'driver')" type="tel" value={driverPhone} onChange={e => setDriverPhone(e.target.value)} placeholder="(XX) XXXXX-XXXX" />

                <h2 className="text-xl font-semibold text-gray-700 border-b pb-2 pt-4">Preferências</h2>
                <RadioGroup legend="App de Navegação Padrão" name="navPreference" options={navOptions} selectedValue={navPreference} onChange={val => setNavPreference(val as string)} />
                <RadioGroup legend="Enviar Notificações WhatsApp via" name="notificationSender" options={senderOptions} selectedValue={notificationSender} onChange={val => setNotificationSender(val as string)} />
                {notificationSender === 'driver' && !driverPhone && 
                    <Alert type="warning" message="Para enviar notificações com 'Meu Número', por favor, preencha seu WhatsApp acima."/>
                }
                 {notificationSender === 'system' && 
                    <Alert type="info" message="As notificações via 'Número do Sistema' estão em desenvolvimento. Por enquanto, pode usar um número de teste ou reverter para 'Meu Número'."/>
                }
                <Button onClick={handleSave} variant="primary" className="w-full" isLoading={state.isLoading}>Salvar Configurações</Button>
            </div>
        </AppShell>
    );
};
const StatisticsPage: React.FC = () => (
    <AppShell title="Estatísticas de Entrega" showLogout showBackButton>
        <div className="p-4 text-center">
            <ChartBarIcon className="w-16 h-16 text-blue-500 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Suas Estatísticas</h2>
            <p className="text-gray-600">Em breve: Acompanhe seu desempenho, entregas por status, tempo médio e mais!</p>
        </div>
    </AppShell>
);
const HowToUsePage: React.FC = () => (
    <AppShell title="Como Usar o RotaSpeed" showLogout showBackButton>
        <div className="p-4 max-w-2xl mx-auto bg-white rounded-lg shadow space-y-6">
            <div className="text-center mb-6">
                <QuestionMarkCircleIcon className="w-16 h-16 text-blue-500 mx-auto mb-3" />
                <h2 className="text-2xl font-bold text-gray-800">Guia Rápido RotaSpeed</h2>
            </div>
            
            <div className="space-y-4">
                <div>
                    <h3 className="text-lg font-semibold text-blue-700 mb-1">1. Configuração Inicial</h3>
                    <p className="text-gray-600 text-sm">Ao fazer login, vá para "Configuração de Entregas" e informe quantos pacotes você planeja entregar.</p>
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-blue-700 mb-1">2. Adicionando Pacotes</h3>
                    <p className="text-gray-600 text-sm">Use as abas "Texto", "Arquivo", "Câmera" ou "Voz" para adicionar seus endereços. A IA tentará extrair os detalhes.</p>
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-blue-700 mb-1">3. Otimizando sua Rota</h3>
                    <p className="text-gray-600 text-sm">Escolha entre otimização "Automática (IA)" (usará sua localização) ou "Manual" (você ordena). Clique em "Concluir e Otimizar Rota".</p>
                </div>
                 <div>
                    <h3 className="text-lg font-semibold text-blue-700 mb-1">4. Realizando Entregas</h3>
                    <p className="text-gray-600 text-sm">Na tela de entrega, use "Abrir no Mapa" para navegar. Marque pacotes como "Entregue" ou "Cancelada". Você também pode notificar clientes.</p>
                </div>
                 <div>
                    <h3 className="text-lg font-semibold text-blue-700 mb-1">5. Configurações e Planos</h3>
                    <p className="text-gray-600 text-sm">Acesse o menu (ícone de usuário) para ir para "Configurações" (personalizar seu nome, telefone para notificações, app de mapa) ou "Meu Plano" para ver detalhes da sua assinatura.</p>
                </div>
            </div>
             <p className="text-center text-sm text-gray-500 mt-8">
                Dúvidas? Contate o suporte. Boas entregas!
            </p>
        </div>
    </AppShell>
);

// --- AppShell & AppRoutes & Main App component ---
interface AppShellProps {
  children: React.ReactNode;
  title: string;
  showLogout?: boolean;
  showBackButton?: boolean;
  customHeaderContent?: React.ReactNode;
}

const AppShell: React.FC<AppShellProps> = ({ children, title, showLogout = false, showBackButton = false, customHeaderContent }) => {
  const { dispatch, state } = useSharedState();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleLogout = async () => {
    setIsMenuOpen(false);
    await supabase.auth.signOut();
    dispatch({ type: 'LOGOUT' });
    navigate('/');
  };
  
  const canGoBack = location.key !== "default" && location.pathname !== "/app/package-setup" && location.pathname !== "/app";

  const excludedPhasesForPlanInactiveModal = [AppPhase.LOGIN, AppPhase.RESET_PASSWORD, AppPhase.SUBSCRIPTION_INFO, AppPhase.COMPLETED];

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-blue-600 text-white p-4 shadow-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center">
            {(showBackButton && canGoBack) && (
              <button onClick={() => navigate(-1)} className="mr-3 p-1 rounded-full hover:bg-blue-700 transition-colors" aria-label="Voltar">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
            )}
            <h1 className="text-xl font-semibold truncate" title={title}>{title}</h1>
          </div>
          <div className="flex items-center space-x-3">
            {customHeaderContent}
            {showLogout && state.user && (
                 <div className="relative">
                    <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="flex items-center text-sm p-1 rounded-full hover:bg-blue-700 focus:outline-none" aria-label="Menu do usuário" aria-expanded={isMenuOpen} aria-haspopup="true">
                       <UserIcon className="w-6 h-6 rounded-full" />
                       <span className="ml-1 hidden md:inline truncate max-w-[100px]" title={state.user?.nome || state.user?.driver_name || state.user.email}>{state.user?.nome || state.user?.driver_name || 'Usuário'}</span>
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 ml-0.5">
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.23 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {isMenuOpen && (
                        <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 z-50 text-gray-700 ring-1 ring-black ring-opacity-5">
                            <Link to="/app/settings" onClick={() => setIsMenuOpen(false)} className="flex items-center px-4 py-2 text-sm hover:bg-gray-100"><Cog6ToothIcon className="mr-2 w-5 h-5 text-gray-500"/>Configurações</Link>
                            <Link to="/app/statistics" onClick={() => setIsMenuOpen(false)} className="flex items-center px-4 py-2 text-sm hover:bg-gray-100"><ChartBarIcon className="mr-2 w-5 h-5 text-gray-500"/>Estatísticas</Link>
                            <Link to="/app/subscription-info" onClick={() => setIsMenuOpen(false)} className="flex items-center px-4 py-2 text-sm hover:bg-gray-100"><CreditCardIcon className="mr-2 w-5 h-5 text-gray-500"/>Meu Plano</Link>
                            <Link to="/app/how-to-use" onClick={() => setIsMenuOpen(false)} className="flex items-center px-4 py-2 text-sm hover:bg-gray-100"><QuestionMarkCircleIcon className="mr-2 w-5 h-5 text-gray-500"/>Como Usar</Link>
                            <div className="border-t border-gray-100 my-1"></div>
                            <button onClick={handleLogout} className="flex items-center w-full text-left px-4 py-2 text-sm hover:bg-gray-100 text-red-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" /></svg>
                                Sair
                            </button>
                        </div>
                    )}
                 </div>
            )}
          </div>
        </div>
      </header>
      <main className="flex-grow container mx-auto p-4 overflow-y-auto pb-16"> {/* Added padding-bottom for scroll clearance */}
         {state.errorMessage && <Alert type="error" message={state.errorMessage} onClose={() => dispatch({ type: 'SET_ERROR_MESSAGE', payload: null })} />}
         {state.successMessage && <Alert type="success" message={state.successMessage} onClose={() => dispatch({ type: 'SET_SUCCESS_MESSAGE', payload: null })} />}
         {state.infoMessage && <Alert type="info" message={state.infoMessage} onClose={() => dispatch({ type: 'SET_INFO_MESSAGE', payload: null })} />}
        {children}
      </main>
       <Modal
        isOpen={state.user?.plano_ativo === false && !excludedPhasesForPlanInactiveModal.includes(state.phase)}
        onClose={() => navigate('/app/subscription-info')}
        title="Plano Inativo"
      >
        <p className="text-gray-700 mb-4">Seu plano RotaSpeed está inativo. Para continuar usando os recursos de otimização e gerenciamento de entregas, por favor, reative seu plano ou escolha uma nova assinatura.</p>
        <Button variant="primary" onClick={() => {dispatch({ type: 'SHOW_UPGRADE_MODAL', payload: false}); navigate('/app/subscription-info')}} className="w-full">Ver Planos</Button>
      </Modal>
       <Modal
        isOpen={state.phase === AppPhase.LIMIT_REACHED && location.pathname !== '/app/subscription-info'}
        onClose={() => navigate('/app/subscription-info')}
        title="Limite de Entregas Atingido"
      >
        <p className="text-gray-700 mb-4">Você atingiu o limite de entregas para o seu plano atual ({state.user?.plano_nome}).</p>
        <p className="text-gray-700 mb-4">Para continuar otimizando mais entregas hoje, considere fazer um upgrade do seu plano.</p>
        <Button variant="primary" onClick={() => {dispatch({type: 'SET_PHASE', payload: AppPhase.PACKAGE_COUNT_SETUP}); navigate('/app/subscription-info')}} className="w-full">Ver Opções de Plano</Button>
      </Modal>
    </div>
  );
};

const ProtectedRoute: React.FC<{ children: JSX.Element }> = ({ children }) => {
  const { state } = useSharedState();
  const location = useLocation();

  if (state.isAuthenticating) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-700 p-4">
        <Spinner size="lg" color="border-white" />
        <p className="text-white mt-4">{state.infoMessage || 'Carregando RotaSpeed...'}</p>
      </div>
    );
  }

  if (!state.user) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }
  
  return children;
};


const AppRoutes: React.FC = () => {
  const { state } = useSharedState();
  return (
    <Routes>
      <Route path="/" element={state.user && !state.isAuthenticating ? <Navigate to="/app/package-setup" replace /> : <LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      
      <Route path="/app" element={<ProtectedRoute><Navigate to="/app/package-setup" replace /></ProtectedRoute>} />
      <Route path="/app/package-setup" element={<ProtectedRoute><PackageSetupPage /></ProtectedRoute>} />
      <Route path="/app/package-input" element={<ProtectedRoute><PackageInputPage /></ProtectedRoute>} />
      <Route path="/app/manual-ordering" element={<ProtectedRoute><ManualOrderingPage /></ProtectedRoute>} />
      <Route path="/app/delivery" element={<ProtectedRoute><DeliveryPage /></ProtectedRoute>} />
      <Route path="/app/completed" element={<ProtectedRoute><CompletedPage /></ProtectedRoute>} />
      <Route path="/app/subscription-info" element={<ProtectedRoute><SubscriptionInfoPage /></ProtectedRoute>} />
      <Route path="/app/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/app/statistics" element={<ProtectedRoute><StatisticsPage /></ProtectedRoute>} />
      <Route path="/app/how-to-use" element={<ProtectedRoute><HowToUsePage /></ProtectedRoute>} />
      
      <Route path="/app/*" element={<ProtectedRoute><Navigate to="/app/package-setup" replace /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

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
