/**
 * 确认对话框组件
 * 用于替代系统的 confirm 对话框
 */
import React from 'react';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: 'danger' | 'primary';
    onConfirm: () => void;
    onCancel: () => void;
    children?: React.ReactNode;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    message,
    confirmText = '确定',
    cancelText = '取消',
    confirmVariant = 'danger',
    onConfirm,
    onCancel,
    children
}) => {
    if (!isOpen) return null;

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onCancel();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[300] flex items-center justify-center p-4"
            onClick={handleBackdropClick}
            style={{ animation: 'fadeIn 0.2s ease-out' }}
        >
            {/* 背景遮罩 */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* 对话框 */}
            <div
                className="relative bg-secondary border border-border-color rounded-2xl p-6 max-w-md w-full shadow-2xl"
                style={{ animation: 'scaleIn 0.2s ease-out' }}
            >
                {/* 标题 */}
                <div className="flex items-start gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${confirmVariant === 'danger'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-blue-500/20 text-blue-400'
                        }`}>
                        <i className={`fas ${confirmVariant === 'danger' ? 'fa-exclamation-triangle' : 'fa-info-circle'} text-xl`} />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-primary">{title}</h3>
                    </div>
                </div>

                {/* 消息内容 */}
                <p className="text-primary mb-6 whitespace-pre-line leading-relaxed pl-13">
                    {message}
                </p>

                {children && (
                    <div className="mb-6 pl-12">
                        {children}
                    </div>
                )}

                {/* 按钮 */}
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onCancel}
                        className="px-5 py-2.5 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 transition-colors font-medium"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-5 py-2.5 rounded-lg transition-colors font-medium text-primary ${confirmVariant === 'danger'
                            ? 'bg-red-500 hover:bg-red-600'
                            : 'bg-blue-500 hover:bg-blue-600'
                            }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>

            {/* 动画样式 */}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scaleIn {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
};
