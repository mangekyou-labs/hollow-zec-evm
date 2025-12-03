"use client";
import React from "react";
import { FaEthereum, FaBtc } from "react-icons/fa";

interface GattaiWalletAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDisconnect: () => void;
  evmAddress: string;
  btcAddress: string;
}

const GattaiWalletAccountModal: React.FC<GattaiWalletAccountModalProps> = ({
  isOpen,
  onClose,
  onDisconnect,
  evmAddress,
  btcAddress,
}) => {
  if (!isOpen) return null;

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    console.log(`Copied ${type} address: ${text}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-gray-800 via-gray-900 to-black border border-blue-900 shadow-2xl text-white w-full max-w-md rounded-xl p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-4 text-gray-500 hover:text-white text-2xl cursor-pointer transition-colors"
        >
          &times;
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-20 h-20 mx-auto mb-3 rounded-full bg-gradient-to-br from-blue-600 to-purple-500 p-1 shadow-lg">
            <img
              src="/icon.png"
              alt="Hollow Wallet"
              className="rounded-full w-full h-full object-cover"
            />
          </div>
          <h2 className="text-xl font-bold text-blue-400">Hollow Wallet</h2>
          <p className="text-sm text-gray-400">Connected</p>
        </div>

        {/* Addresses */}
        <div className="space-y-4 mb-6">
          {/* EVM Address */}
          <div className="space-y-1">
            <label className="text-sm text-gray-300 flex items-center gap-2">
              <FaEthereum className="text-gray-400" /> EVM Address
            </label>
            <div className="flex items-center bg-gray-700 rounded-md p-2">
              <p className="flex-grow font-mono text-xs break-all text-gray-300">
                {evmAddress}
              </p>
              <button
                onClick={() => copyToClipboard(evmAddress, "EVM")}
                className="ml-3 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
              >
                Copy
              </button>
            </div>
          </div>

          {/* BTC Address */}
          <div className="space-y-1">
            <label className="text-sm text-gray-300 flex items-center gap-2">
              <FaBtc className="text-yellow-500" /> BTC Address
            </label>
            <div className="flex items-center bg-gray-700 rounded-md p-2">
              <p className="flex-grow font-mono text-xs break-all text-gray-300">
                {btcAddress}
              </p>
              <button
                onClick={() => copyToClipboard(btcAddress, "BTC")}
                className="ml-3 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
              >
                Copy
              </button>
            </div>
          </div>
        </div>

        {/* Disconnect Button */}
        <button
          onClick={onDisconnect}
          className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-md transition-all cursor-pointer shadow-sm"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
};

export default GattaiWalletAccountModal;
