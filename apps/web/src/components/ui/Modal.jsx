import React, { useEffect } from 'react';

export const Modal = ({ isOpen, onClose, children, className = '' }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex justify-center items-center z-50"
      onClick={onClose}
    >
      <div
        className={`bg-black rounded-lg overflow-hidden ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

export const PreviewBox = ({ isOpen, onClose, videoRef, className = '' }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div
        className={`w-[90vw] max-w-[400px] bg-black rounded-lg overflow-hidden p-2.5 flex justify-center items-center ${className}`}
      >
        <video ref={videoRef} className="w-full h-auto rounded-lg" autoPlay playsInline />
      </div>
    </Modal>
  );
};

export default { Modal, PreviewBox };
