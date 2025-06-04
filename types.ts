

export interface AddressInfo {
  id: string;
  fullAddress: string;
  street?: string;
  number?: string;
  bairro?: string;
  complemento?: string;
  cep?: string;
  city?: string;
  state?: string;
  recipientName?: string;
  telefone?: string; 
  originalInput?: string;
  inputType?: InputType;
}

export interface PackageInfo extends AddressInfo {
  // FIX: Standardize status to English terms. DB will use Portuguese.
  status: 'pending' | 'parsed' | 'error' | 'delivered' | 'undeliverable' | 'in_transit' | 'cancelled';
  errorMessage?: string;
  // Fields from 'entregas' table that might be useful in frontend state
  user_id?: string;
  route_id?: string | null;
  delivery_notes?: string | null;
  // 'order' is part of RouteStop, but PackageInfo can represent an item before optimization too.
  // Optimized order is stored as 'optimized_order' in DB, maps to 'order' in RouteStop
  // FIX: Add optimized_order to PackageInfo as it can exist before becoming a RouteStop if fetched from DB
  optimized_order?: number | null;
  // FIX: Add created_at to PackageInfo
  created_at?: string;
}

export interface RouteStop extends PackageInfo {
  order: number; 
}

export enum AppPhase {
  LOGIN = 'login',
  RESET_PASSWORD = 'reset_password',
  PACKAGE_COUNT_SETUP = 'package_count_setup',
  PACKAGE_INPUT = 'package_input',
  MANUAL_ORDERING = 'manual_ordering',
  ROUTE_OPTIMIZATION = 'route_optimization', 
  DELIVERY = 'delivery',
  COMPLETED = 'completed',
  SUBSCRIPTION_INFO = 'subscription_info',
  PLAN_EXPIRED = 'plan_expired', 
  LIMIT_REACHED = 'limit_reached',
  SETTINGS = 'settings', // New phase for Settings page
  STATISTICS = 'statistics', // New phase for Statistics page
  HOW_TO_USE = 'how_to_use' // New phase for How To Use page
}

export enum InputType {
  TEXT = 'text',
  PHOTO = 'photo',
  VOICE = 'voice',
  FILE_PDF = 'pdf',
  FILE_SHEET = 'sheet',
  CAMERA = 'camera'
}

export interface User {
  id: string; 
  email: string | undefined;
  nome?: string | null; // Added 'nome' field for user's actual name
  plano_nome: string;
  entregas_dia_max: number;
  entregas_hoje: number;
  saldo_creditos: number;
  plano_ativo: boolean;
  entregas_gratis_utilizadas: number;
  // New fields for settings
  driver_name?: string | null;
  driver_phone?: string | null;
  navigation_preference?: 'google' | 'waze' | 'apple' | string; // string for flexibility
  notification_sender_preference?: 'driver' | 'system' | string; // string for flexibility
  // Supabase audit fields (optional in frontend type if not directly used)
  created_at?: string; // Matches 'ultima_atualizacao' if it's the creation timestamp
  updated_at?: string; // 'ultima_atualizacao' if it's for updates
}

export interface UserCoordinates {
  latitude: number;
  longitude: number;
}

// Represents an entry in the 'entregas' Supabase table
export interface EntregaDbRecord {
    id: string; // UUID
    user_id: string; // UUID, FK to auth.users
    created_at: string; // timestamp
    updated_at: string; // timestamp for updates
    // FIX: Ensure DB status types are clear
    status: 'pendente' | 'em_rota' | 'entregue' | 'cancelada' | 'nao_entregue'; // Added nao_entregue as a potential DB status for undeliverable
    full_address: string;
    street?: string | null;
    number?: string | null;
    bairro?: string | null;
    complemento?: string | null;
    cep?: string | null;
    city?: string | null;
    state?: string | null;
    recipient_name?: string | null;
    telefone?: string | null;
    original_input?: string | null;
    input_type?: InputType | string | null;
    optimized_order?: number | null;
    route_id?: string | null;
    delivery_notes?: string | null;
}


export interface AppState {
  phase: AppPhase;
  user: User | null;
  totalPackagesEstimate: number;
  packages: PackageInfo[]; // Represents packages being actively worked on, potentially sourced from DB
  optimizedRoute: RouteStop[];
  currentStopIndex: number;
  isLoading: boolean;
  isFetchingLocation: boolean;
  errorMessage: string | null;
  successMessage: string | null;
  infoMessage: string | null; // Can be used for "Criando perfil..."
  isMicrophoneAvailable: boolean;
  isSpeechRecognitionSupported: boolean;
  userLocation: UserCoordinates | null;
  manualOriginAddress: string | null; 
  optimizationMode: 'auto' | 'manual';
  showPlanLimitModal: boolean; 
  showUpgradeModal: boolean; 
  showNotifyAllModal: boolean;
  showCameraModal: boolean;
  showManualOriginModal: boolean;
  isAuthenticating: boolean; 
  // New state for password reset
  showPasswordResetModal?: boolean;
  passwordResetEmailSent?: boolean;
}

export type AppAction =
  | { type: 'LOGIN_SUCCESS'; payload: User }
  | { type: 'LOGOUT' }
  | { type: 'SET_TOTAL_PACKAGES_ESTIMATE'; payload: number }
  | { type: 'ADD_PACKAGES'; payload: PackageInfo[] } // Could be from parsing or fetching
  | { type: 'SET_PACKAGES'; payload: PackageInfo[] } // To replace all current packages, e.g., after fetching
  | { type: 'UPDATE_PACKAGE'; payload: PackageInfo } // Used for local updates or after DB update
  | { type: 'REMOVE_PACKAGE'; payload: string } // id
  | { type: 'SET_OPTIMIZED_ROUTE'; payload: RouteStop[]; isNewOptimization?: boolean }
  | { type: 'SET_MANUALLY_ORDERED_PACKAGES'; payload: PackageInfo[]; isNewOptimization?: boolean }
  // FIX: Change MARK_DELIVERED to UPDATE_PACKAGE_STATUS and include newStatus
  | { type: 'UPDATE_PACKAGE_STATUS'; payload: { id: string; newStatus: PackageInfo['status'] } }
  | { type: 'NEXT_STOP' }
  | { type: 'SET_PHASE'; payload: AppPhase }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_FETCHING_LOCATION'; payload: boolean }
  | { type: 'SET_ERROR_MESSAGE'; payload: string | null }
  | { type: 'SET_SUCCESS_MESSAGE'; payload: string | null }
  | { type: 'SET_INFO_MESSAGE'; payload: string | null }
  | { type: 'CLEAR_PACKAGES_AND_ROUTE' }
  | { type: 'SET_SPEECH_RECOGNITION_STATUS'; payload: { available: boolean, supported: boolean } }
  | { type: 'SET_USER_LOCATION'; payload: UserCoordinates | null }
  | { type: 'SET_MANUAL_ORIGIN_ADDRESS'; payload: string | null }
  | { type: 'SET_OPTIMIZATION_MODE'; payload: 'auto' | 'manual' }
  | { type: 'SHOW_PLAN_LIMIT_MODAL'; payload: boolean }
  | { type: 'SHOW_UPGRADE_MODAL'; payload: boolean }
  | { type: 'SHOW_NOTIFY_ALL_MODAL'; payload: boolean }
  | { type: 'SHOW_CAMERA_MODAL'; payload: boolean }
  | { type: 'SHOW_MANUAL_ORIGIN_MODAL'; payload: boolean }
  | { type: 'SET_IS_AUTHENTICATING'; payload: boolean }
  | { type: 'UPDATE_USER_DELIVERY_COUNTS'; payload: { entregas_hoje: number; entregas_gratis_utilizadas?: number } }
  | { type: 'UPDATE_USER_SETTINGS_SUCCESS'; payload: Partial<User> } // For settings page
  | { type: 'SHOW_PASSWORD_RESET_MODAL'; payload: boolean }
  | { type: 'PASSWORD_RESET_EMAIL_SENT'; payload: boolean }
  | { type: 'UPDATE_USER_PROFILE_SILENT'; payload: Partial<User> };


export interface ParsedAddressFromAI {
  fullAddress?: string;
  address?: string; 
  street?: string;
  number?: string; 
  bairro?: string;
  complemento?: string;
  cep?: string;
  city?: string;
  state?: string;
  recipientName?: string; 
  telefone?: string; 
}