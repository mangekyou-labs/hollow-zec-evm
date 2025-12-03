// components/ConnectGattaiModal.tsx
import React, { useState } from "react";

interface ConnectGattaiModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (url: string) => void;
}

const ConnectGattaiModal: React.FC<ConnectGattaiModalProps> = ({
  isOpen,
  onClose,
  onConnect,
}) => {
  const [url, setUrl] = useState("http://localhost:8080");

  if (!isOpen) return null;

  const handleConnect = () => {
    if (url.trim()) onConnect(url.trim());
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
          Connect Hollow Wallet
        </h2>

        {/* Explanation */}
        <div className="bg-blue-900/60 border border-blue-500 text-blue-200 px-4 py-3 rounded-md text-sm space-y-1">
          <div className="font-bold">ℹ️ Explanation</div>
          <p>
            Hollow Wallet acts as a <strong>Shade Agent</strong> built on NEAR,
            enabling
            <strong> chain signature</strong> to sign{" "}
            <strong>1inch fusion + cross-chain orders </strong>
            based on the <strong>user's intent</strong>.
          </p>
          <p>
            To use Hollow Wallet, deploy your own Agent instance and provide its
            URL below. This Agent will be responsible for signing intent-based
            transactions securely via the chain. More details are available{" "}
            <a
              href="https://shadeprotocol.io/docs/agents"
              className="underline text-blue-300"
              target="_blank"
              rel="noreferrer"
            >
              here
            </a>
            .
          </p>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Hollow Wallet Agent URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://agent.example.com"
            className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Connect Button */}
        <button
          onClick={handleConnect}
          className="w-full py-2 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition text-base cursor-pointer"
        >
          Connect
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

export default ConnectGattaiModal;
