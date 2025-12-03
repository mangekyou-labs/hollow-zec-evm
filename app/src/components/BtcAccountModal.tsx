"use client";
import React from "react";

interface BtcAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  onDisconnect: () => void;
}

const BtcAccountModal: React.FC<BtcAccountModalProps> = ({
  isOpen,
  onClose,
  address,
  onDisconnect,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md cursor-pointer"
      onClick={onClose}
    >
      <div
        className="bg-white text-black w-80 rounded-2xl p-5 shadow-2xl relative cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-gray-500 hover:text-black text-xl cursor-pointer"
        >
          &times;
        </button>

        {/* Icon */}
        <div className="text-center mb-3">
          <img
            src="/coins/btc.png"
            alt="BTC"
            className="w-14 h-14 mx-auto rounded-full"
          />
        </div>

        {/* Truncated Address */}
        <div className="text-center font-semibold text-lg mb-1">
          {address.slice(0, 4)}...{address.slice(-4)}
        </div>

        {/* Balance (Optional hardcoded for now) */}
        <div className="text-center text-sm text-gray-600 mb-4">0.0001 BTC</div>

        {/* Buttons: Copy & Disconnect */}
        <div className="flex justify-between items-center gap-2">
          <button
            onClick={() => navigator.clipboard.writeText(address)}
            className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium cursor-pointer"
          >
            Copy Address
          </button>
          <button
            onClick={onDisconnect}
            className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium cursor-pointer"
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
};

export default BtcAccountModal;
