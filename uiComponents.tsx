
import React from 'react';
import { Link } from 'react-router-dom'; // Import Link for Button as Link

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
  as?: typeof Link | 'button'; // Add 'as' prop
  to?: string; // Add 'to' prop for Link
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  children,
  className,
  disabled,
  as: Component = 'button', // Default to 'button'
  to,
  ...props
}) => {
  const baseStyles = 'font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-150 ease-in-out flex items-center justify-center';
  const variantStyles = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800 focus:ring-gray-400',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
    ghost: 'bg-transparent hover:bg-gray-100 text-blue-600 focus:ring-blue-500',
  };
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };
  const disabledStyles = 'opacity-50 cursor-not-allowed';

  const combinedClassName = `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${disabled || isLoading ? disabledStyles : ''} ${className || ''}`;

  if (Component === Link && to) {
    return (
      <Link to={to} className={combinedClassName} {...(props as any)}> {/* Cast props for Link */}
        {isLoading && <Spinner size="sm" className="mr-2" />}
        {children}
      </Link>
    );
  }

  return (
    <button
      className={combinedClassName}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Spinner size="sm" className="mr-2" />}
      {children}
    </button>
  );
};

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ label, error, id, className, icon, ...props }, ref) => {
  return (
    <div className="w-full">
      {label && <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <div className="relative">
        {icon && <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">{icon}</div>}
        <input
          id={id}
          ref={ref}
          className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none sm:text-sm ${icon ? 'pl-10' : ''} ${error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'} ${className || ''}`}
          {...props}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
});
Input.displayName = 'Input';


interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea: React.FC<TextareaProps> = ({ label, error, id, className, ...props }) => {
  return (
    <div className="w-full">
      {label && <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <textarea
        id={id}
        rows={4}
        className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none sm:text-sm ${error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'} ${className || ''}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
};


interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, size = 'md' }) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div className={`bg-white rounded-lg shadow-xl w-full mx-auto overflow-hidden ${sizeClasses[size]}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto">
          {children}
        </div>
        {footer && (
          <div className="p-4 border-t flex justify-end space-x-2 bg-gray-50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  color?: string;
}
export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = '', color = 'border-blue-500' }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };
  return (
    <div className={`animate-spin rounded-full border-t-2 border-b-2 ${color} ${sizeClasses[size]} ${className}`}></div>
  );
};

interface RadioGroupOption<T extends string | number> { // Allow number for value type
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface RadioGroupProps<T extends string | number> {
  name: string;
  options: RadioGroupOption<T>[];
  selectedValue: T;
  onChange: (value: T) => void;
  legend?: string;
  className?: string;
}

export const RadioGroup = <T extends string | number>({ name, options, selectedValue, onChange, legend, className }: RadioGroupProps<T>) => {
  return (
    <fieldset className={className}>
      {legend && <legend className="text-sm font-medium text-gray-900 mb-2">{legend}</legend>}
      <div className="space-y-2 sm:space-y-0 sm:flex sm:space-x-4 sm:flex-wrap"> {/* Added flex-wrap */}
        {options.map((option) => (
          <div key={String(option.value)} className="flex items-center mr-4 mb-2 sm:mb-0"> {/* Added margin for wrap */}
            <input
              id={`${name}-${String(option.value)}`}
              name={name}
              type="radio"
              checked={option.value === selectedValue}
              onChange={() => onChange(option.value)}
              className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <label htmlFor={`${name}-${String(option.value)}`} className="ml-2 block text-sm font-medium text-gray-700 flex items-center">
              {option.icon && <span className="mr-1.5">{option.icon}</span>}
              {option.label}
            </label>
          </div>
        ))}
      </div>
    </fieldset>
  );
};


// Icon components
export const UserIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
  </svg>
);

export const LockClosedIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
);

export const PackageIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10.5 11.25h3M12 15V7.5m0 0l-3 3m3-3l3 3M3.75 7.5H20.25z" />
  </svg>
);

export const CameraIcon: React.FC<{className?: string}> = ({ className }) => (
 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
  </svg>
);

export const MicrophoneIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
  </svg>
);

export const DocumentTextIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
  </svg>
);

export const UploadIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
  </svg>
);

export const MapPinIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
  </svg>
);

export const CheckCircleIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

export const XCircleIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

export const CloseIcon: React.FC<{className?: string}> = ({className}) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export const TrashIcon: React.FC<{className?: string}> = ({className}) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12.56 0c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
);

export const ArrowPathIcon: React.FC<{className?: string}> = ({className}) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 11.664 0l3.181-3.183m-3.181-3.183L16.023 6.165m0 0a8.25 8.25 0 0 0-11.664 0L2.985 9.348m11.664-3.183h4.992m0 0v4.992m0-4.993L16.023 9.348" />
  </svg>
);

export const PaperAirplaneIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
  </svg>
);

export const WhatsAppIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={`w-5 h-5 ${className || ''}`} fill="currentColor">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.35 3.43 16.84L2.05 22L7.31 20.55C8.76 21.31 10.36 21.73 12.04 21.73C17.5 21.73 21.95 17.28 21.95 11.82C21.95 6.36 17.5 2 12.04 2M12.04 3.67C16.56 3.67 20.28 7.38 20.28 11.82C20.28 16.26 16.56 19.97 12.04 19.97C10.52 19.97 9.08 19.59 7.82 18.91L7.44 18.7L4.82 19.44L5.58 16.9L5.36 16.5C4.61 15.13 4.21 13.53 4.21 11.91C4.21 7.47 7.93 3.67 12.04 3.67M17.32 14.23C17.06 14.72 16.23 15.14 15.79 15.25C15.36 15.36 14.88 15.47 13.76 15.04C12.43 14.51 11.31 13.33 10.31 12.12C9.49002 11.12 9.05002 10.41 8.88002 10.15C8.72002 9.89 8.43002 9.73 8.17002 9.52C7.91002 9.32 7.73002 9.24 7.55002 9.07C7.37002 8.91 7.20002 8.75 7.08002 8.53C6.97002 8.31 6.81002 8.03 6.93002 7.76C7.05002 7.5 7.27002 7.28 7.53002 7.12C7.67002 7.03 7.81002 6.99 7.93002 6.99C8.06002 6.99 8.17002 6.99001 8.28002 7.00001C8.45002 7.01001 8.58002 7.02001 8.70002 7.31C8.83002 7.6 9.18002 8.43 9.27002 8.58C9.36002 8.73 9.42002 8.89 9.33002 9.05C9.24002 9.21 9.17002 9.29001 9.04002 9.43001C8.91002 9.57001 8.80002 9.67001 8.69002 9.79001C8.58002 9.90001 8.45002 10.03 8.58002 10.28C8.72002 10.54 9.25002 11.31 9.97002 11.95C10.89 12.78 11.56 13.08 11.85 13.21C12.14 13.33 12.33 13.31 12.49 13.15C12.65 12.98 12.95 12.59 13.14 12.31C13.34 12.03 13.56 11.97 13.80 12.06C14.05 12.15 14.83 12.52 15.09 12.65C15.35 12.78 15.53 12.84 15.60 12.93C15.67 13.02 15.67 13.28 15.44 13.53C15.22 13.78 14.88 14.09 14.68 14.23C14.61 14.28 17.58 14.72 17.32 14.23Z"/>
  </svg>
);


export const Alert: React.FC<{ type: 'success' | 'error' | 'info' | 'warning'; message: string | React.ReactNode; onClose?: () => void }> = ({ type, message, onClose }) => {
  const baseClasses = "p-4 rounded-md flex items-center justify-between shadow-md";
  const typeClasses = {
    success: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
    warning: "bg-yellow-100 text-yellow-700",
  };
  const IconComponents = {
    success: CheckCircleIcon,
    error: XCircleIcon,
    info: InformationCircleIcon,
    warning: ExclamationTriangleIcon,
  }

  if (!message) return null;
  const Icon = IconComponents[type];

  return (
    <div className={`${baseClasses} ${typeClasses[type]} my-4`}>
      <div className="flex items-start">
        {Icon && <Icon className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />}
        <span>{message}</span>
      </div>
      {onClose && (
        <button onClick={onClose} className="ml-4 text-current hover:opacity-75 self-start">
          <CloseIcon className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};

export const InformationCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
  </svg>
);

export const ExclamationTriangleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.008v.008H12v-.008Z" />
  </svg>
);

export const ListBulletIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);

export const Bars3Icon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
  </svg>
);


export const ArrowUpIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
  </svg>
);

export const ArrowDownIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
  </svg>
);

export const ShareIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.19.025.383.05.577.076M7.217 10.907a2.25 2.25 0 0 1-.577.076m0 0a2.25 2.25 0 0 0 0 2.034m0-2.034c-.19.025-.383.05-.577.076m0 0c.19.025.383.05.577.076M14.25 7.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm0 0c-.19.025-.383.05-.577.076M14.25 7.5a2.25 2.25 0 0 1 .577.076m0 0a2.25 2.25 0 0 0 0 4.348m0-4.348c.19-.025.383-.05.577-.076m0 0C15.19 7.525 15.383 7.55 15.577 7.576m0 0a2.25 2.25 0 0 0 0 4.348M16.875 10.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm0 0c.19.025.383.05.577.076m-1.154 0c.19.025.383.05.577.076m0 0c.19.025.383.05.577.076m0 0a2.25 2.25 0 0 1-.577.076m0 0c.19.025.383.05.577.076M9 12.75a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5Zm0 0c.19.025.383.05.577.076M9 12.75a2.25 2.25 0 0 0-.577.076M9 12.75c.19.025.383.05.577.076m0 0a2.25 2.25 0 0 0 0 4.348m0-4.348c-.19.025-.383.05-.577.076M6.75 15a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm0 0c-.19.025-.383.05-.577.076m0 0a2.25 2.25 0 0 1 .577.076m0 0c.19.025.383.05.577.076M6.75 15c.19.025.383.05.577.076m0 0a2.25 2.25 0 0 0 0 4.348m0-4.348L7.217 10.907M16.875 10.5l.468-2.629M12 3.75l.468 2.629m0 0L12 9.75M12 3.75l-.468 2.629M12 3.75V9.75m0 0L16.875 15M12 9.75L7.217 15M12 9.75L16.875 15" />
  </svg>
);

export const CreditCardIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h6m3-5.25H21m-9 5.25h5.25M6 18a2.25 2.25 0 0 0 2.25-2.25H3.75A2.25 2.25 0 0 0 6 18Zm12 0a2.25 2.25 0 0 0 2.25-2.25h-4.5a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
);

export const Cog6ToothIcon: React.FC<{className?: string}> = ({ className }) => ( // Settings Icon
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.096.573.393 1.07.799 1.414l.893.893c.406.406.941.628 1.485.628h1.281c.542 0 .94.56.94 1.11v2.594c0 .55-.398 1.02-.94 1.11l-1.28.213c-.574.096-1.079.393-1.414.799l-.894.893c-.405.406-.627.94-.627 1.485v1.28c0 .542-.56.94-1.11.94h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.096-.573-.393-1.07-.799-1.414l-.893-.893c-.406-.406-.941-.628-1.485-.628H3.94c-.542 0-.94-.56-.94-1.11v-2.594c0-.55.398-1.02.94-1.11l1.28-.213c.573-.096 1.079-.393 1.414-.799l.893-.893c.407-.406.628-.94.628-1.485v-1.28c0-.542.56-.94 1.11-.94Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
);

export const ChartBarIcon: React.FC<{className?: string}> = ({ className }) => ( // Statistics Icon
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
  </svg>
);

export const QuestionMarkCircleIcon: React.FC<{className?: string}> = ({ className }) => ( // Help/HowToUse Icon
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 ${className || ''}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
  </svg>
);

export const GoogleIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg className={`w-5 h-5 ${className || ''}`} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M48 24C48 22.0427 47.8439 20.129 47.5413 18.2727H24.4545V28.8523H37.7545C37.1932 32.2523 35.4795 35.0659 32.7977 36.9591V43.0841H41.0045C45.4091 39.0341 48 32.2023 48 24Z" fill="#4285F4"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M24.4545 48.0001C30.8455 48.0001 36.2318 45.8955 40.0909 42.2591L32.7977 36.9591C30.7273 38.3227 27.8841 39.2273 24.4545 39.2273C18.0205 39.2273 12.6114 35.0046 10.7682 29.4773H2.27955V35.7614C6.09545 43.2841 14.6159 48.0001 24.4545 48.0001Z" fill="#34A853"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M10.7682 29.4772C10.2955 28.0977 10.0023 26.6091 10.0023 25.0681C10.0023 23.5272 10.2955 22.0386 10.7682 20.6591V14.375H2.27955C0.843182 17.1614 0 20.5227 0 24.1136C0 27.7045 0.843182 31.0659 2.27955 33.8522L10.7682 29.4772Z" fill="#FBBC05"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M24.4545 8.72727C28.2523 8.72727 31.25 10.0091 33.6818 12.1409L40.2909 5.78636C36.2318 2.18636 30.8455 0 24.4545 0C14.6159 0 6.09545 4.71591 2.27955 12.2386L10.7682 18.5227C12.6114 12.9955 18.0205 8.72727 24.4545 8.72727Z" fill="#EA4335"/>
  </svg>
);
