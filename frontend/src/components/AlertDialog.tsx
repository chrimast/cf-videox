/**
 * 提示对话框组件
 * 用于替代系统的 alert 对话框
 */
import React from 'react';

interface AlertDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    variant?: 'success' | 'error' | 'info' | 'warning';
    buttonText?: string;
    onClose: () => void;
}

export const AlertDialog: React.FC<AlertDialogProps> = ({
    isOpen,
    title,
    message,
    variant = 'info',
    buttonText = '确定',
    onClose
}) => {
    if (!isOpen) return null;

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const variantConfig = {
        success: {
            bgColor: 'bg-green-500/20',
            textColor: 'text-green-400',
            icon: 'fa-check-circle',
            buttonColor: 'bg-green-500 hover:bg-green-600'
        },
        error: {
            bgColor: 'bg-red-500/20',
            textColor: 'text-red-400',
            icon: 'fa-times-circle',
            buttonColor: 'bg-red-500 hover:bg-red-600'
        },
        warning: {
            bgColor: 'bg-orange-500/20',
            textColor: 'text-orange-400',
            icon: 'fa-exclamation-triangle',
            buttonColor: 'bg-orange-500 hover:bg-orange-600'
        },
        info: {
            bgColor: 'bg-blue-500/20',
            textColor: 'text-blue-400',
            icon: 'fa-info-circle',
            buttonColor: 'bg-blue-500 hover:bg-blue-600'
        }
    };

    const config = variantConfig[variant];

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
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${config.bgColor} ${config.textColor}`}>
                        <i className={`fas ${config.icon} text-xl`} />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-primary">{title}</h3>
                    </div>
                </div>

                {/* 消息内容 */}
                <p className="text-primary mb-6 whitespace-pre-line leading-relaxed pl-13">
                    {message}
                </p>

                {/* 按钮 */}
                <div className="flex justify-end">
                    <button
                        onClick={onClose}
                        className={`px-5 py-2.5 rounded-lg transition-colors font-medium text-primary ${config.buttonColor}`}
                    >
                        {buttonText}
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
