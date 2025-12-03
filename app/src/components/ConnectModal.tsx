"use client";
import React from "react";

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectEVM: () => void;
  onConnectBTC: () => void;
  onConnectGattai: () => void;
  isEvmConnected: boolean;
  isBtcConnected: boolean;
}

const ConnectModal: React.FC<ConnectModalProps> = ({
  isOpen,
  onClose,
  onConnectEVM,
  onConnectBTC,
  onConnectGattai,
  isEvmConnected,
  isBtcConnected,
}) => {
  if (!isOpen) return null;

  // --- STYLE CHANGE IS HERE ---
  // This new style provides a subtle, "grayed-out" look.
  const connectedClasses =
    "w-full py-2 bg-slate-800 border border-slate-700 text-slate-500 rounded-md cursor-not-allowed flex items-center justify-center gap-2";

  const defaultClasses =
    "w-full py-2 rounded-md transition cursor-pointer font-semibold";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md cursor-pointer"
      onClick={onClose}
    >
      <div
        className="bg-slate-900/80 p-6 rounded-xl w-96 text-white space-y-6 relative cursor-default border border-slate-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Section 1: Chain Abstraction */}
        <div className="space-y-3 border-b border-gray-700 pb-4">
          <h3 className="text-lg font-semibold text-center text-gray-300">
            Try Chain Abstraction
          </h3>
          <button
            onClick={onConnectGattai}
            className={`${defaultClasses} bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600`}
          >
            Hollow Wallet
          </button>
        </div>

        {/* Section 2: Specific Wallet Connect */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-center text-gray-300">
            Connect Wallet on Specific Chain
          </h3>

          {isEvmConnected ? (
            <button className={connectedClasses} disabled>
              EVM Wallet Connected
            </button>
          ) : (
            <button
              onClick={onConnectEVM}
              className={`${defaultClasses} bg-blue-600 hover:bg-blue-700`}
            >
              EVM Wallet
            </button>
          )}

          {isBtcConnected ? (
            <button className={connectedClasses} disabled>
              BTC Wallet Connected
            </button>
          ) : (
            <button
              onClick={onConnectBTC}
              className={`${defaultClasses} bg-yellow-600 hover:bg-yellow-700`}
            >
              BTC Wallet
            </button>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-gray-400 hover:text-white text-xl cursor-pointer"
        >
          &times;
        </button>
      </div>
    </div>
  );
};

export default ConnectModal;
