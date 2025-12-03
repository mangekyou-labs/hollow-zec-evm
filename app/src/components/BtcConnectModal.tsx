import React, { useState } from "react";

interface BtcConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (privateKey: string) => void;
}

const BtcConnectModal: React.FC<BtcConnectModalProps> = ({
  isOpen,
  onClose,
  onConnect,
}) => {
  const [privateKey, setPrivateKey] = useState("");

  if (!isOpen) return null;

  const handleConnect = () => {
    if (privateKey.trim()) {
      onConnect(privateKey.trim());
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md cursor-pointer"
      onClick={onClose}
    >
      <div
        className="bg-slate-900/80 p-6 rounded-xl w-96 text-white space-y-6 relative cursor-default border border-slate-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h2 className="text-xl font-bold text-center text-gray-300">
          Connect Bitcoin Wallet (Testnet3)
        </h2>

        {/* Warning */}
        <div className="bg-red-900/60 border border-red-500 text-red-200 px-4 py-3 rounded-md text-sm space-y-1">
          <div className="font-bold">⚠️ WARNING!</div>
          <p>For Testnet3 ONLY. Do not use a mainnet key.</p>
          <p>
            This method is insecure and stores your key in localStorage. Use for
            testing only.
          </p>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <label
            htmlFor="privateKey"
            className="block text-sm font-medium text-gray-300"
          >
            Private Key (WIF format)
          </label>
          <input
            type="password"
            id="privateKey"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="Your WIF private key"
            className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Connect Button */}
        <button
          onClick={handleConnect}
          className="w-full py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition font-semibold"
        >
          Connect Wallet
        </button>

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

export default BtcConnectModal;
