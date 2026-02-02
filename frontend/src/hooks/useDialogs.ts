/**
 * 对话框 Hooks
 * 提供便捷的对话框调用方法
 */
import { useState, useCallback } from 'react';

// Confirm Dialog State
export interface ConfirmDialogState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'primary';
}

// Alert Dialog State
export interface AlertDialogState {
    isOpen: boolean;
    title: string;
    message: string;
    variant?: 'success' | 'error' | 'info' | 'warning';
}

export const useDialogs = () => {
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [alertDialog, setAlertDialog] = useState<AlertDialogState | null>(null);

    const showConfirm = useCallback((
        title: string,
        message: string,
        onConfirm: () => void,
        variant: ConfirmDialogState['variant'] = 'danger'
    ) => {
        setConfirmDialog({ isOpen: true, title, message, onConfirm, variant });
    }, []);

    const hideConfirm = useCallback(() => {
        setConfirmDialog(null);
    }, []);

    const showAlert = useCallback((
        title: string,
        message: string,
        variant: AlertDialogState['variant'] = 'info'
    ) => {
        setAlertDialog({ isOpen: true, title, message, variant });
    }, []);

    const hideAlert = useCallback(() => {
        setAlertDialog(null);
    }, []);

    // 便捷方法
    const showSuccess = useCallback((title: string, message: string) => {
        showAlert(title, message, 'success');
    }, [showAlert]);

    const showError = useCallback((title: string, message: string) => {
        showAlert(title, message, 'error');
    }, [showAlert]);

    const showWarning = useCallback((title: string, message: string) => {
        showAlert(title, message, 'warning');
    }, [showAlert]);

    const showInfo = useCallback((title: string, message: string) => {
        showAlert(title, message, 'info');
    }, [showAlert]);

    return {
        // State
        confirmDialog,
        alertDialog,
        // Core Methods
        showConfirm,
        hideConfirm,
        showAlert,
        hideAlert,
        // Convenience Methods
        showSuccess,
        showError,
        showWarning,
        showInfo,
    };
};
