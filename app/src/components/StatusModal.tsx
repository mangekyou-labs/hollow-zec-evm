// components/StatusModal.tsx
"use client";
import React, { useEffect, useRef } from "react";

export type StatusState = "loading" | "done" | "failed" | "idle";

export interface Status {
  text: string;
  state: StatusState;
  explorers?: {
    explorerUrl: string;
    network?: string;
  }[];
}

interface StatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  statuses: Status[];
  title: string;
  fromChainName: string;
  toChainName: string;
  fromAmount: string;
  toAmount: string;
  fromSymbol: string;
  toSymbol: string;
}

const StatusIcon = ({ state }: { state: StatusState }) => {
  const baseClasses =
    "w-6 h-6 rounded-full flex items-center justify-center z-10 flex-shrink-0";
  switch (state) {
    case "loading":
      return (
        <div className={`${baseClasses} bg-gray-700`}>
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
        </div>
      );
    case "done":
      return (
        <div className={`${baseClasses} bg-green-500/20 text-green-400`}>✓</div>
      );
    case "failed":
      return (
        <div className={`${baseClasses} bg-red-500/20 text-red-400`}>✗</div>
      );
    default:
      return (
        <div className={`${baseClasses} bg-gray-700`}>
          <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
        </div>
      );
  }
};

const StatusModal: React.FC<StatusModalProps> = ({
  isOpen,
  onClose,
  statuses,
  title,
  fromChainName,
  toChainName,
  fromAmount,
  toAmount,
  fromSymbol,
  toSymbol,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [statuses]);

  if (!isOpen) return null;

  const isComplete = statuses.every((s) => s.state !== "loading");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="bg-slate-900/80 border border-slate-700 rounded-lg shadow-2xl w-full max-w-md p-6 m-4 flex flex-col">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          {isComplete && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl"
            >
              &times;
            </button>
          )}
        </div>

        {/* Swap Information Section */}
        <div className="my-4 p-4 bg-black/20 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between text-sm">
            <div className="text-left">
              <p className="text-gray-400">From</p>
              <p className="font-semibold text-lg text-white">
                {fromAmount} {fromSymbol}
              </p>
              <p className="text-gray-400 text-xs">{fromChainName}</p>
            </div>
            <div className="text-gray-500 text-2xl font-light mx-2 self-center">
              →
            </div>
            <div className="text-right">
              <p className="text-gray-400">To</p>
              <p className="font-semibold text-lg text-white">
                {toAmount} {toSymbol}
              </p>
              <p className="text-gray-400 text-xs">{toChainName}</p>
            </div>
          </div>
        </div>

        {/* Explanatory Note */}
        <div className="mb-4 p-3 bg-blue-900/20 text-blue-200 text-xs rounded-lg flex items-start gap-2">
          <span className="mt-0.5">ℹ️</span>
          <p>
            Please keep this browser window open. The final step requires
            sharing a secret from this session after the transaction achieves
            finality.
          </p>
        </div>

        {/* Status Timeline */}
        <div
          ref={scrollRef}
          className="space-y-1 max-h-[40vh] overflow-y-auto pr-3 -mr-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900"
        >
          {statuses.map((status, index) => (
            <div key={index} className="flex items-start">
              <div className="flex flex-col items-center mr-4">
                <StatusIcon state={status.state} />
                {index < statuses.length - 1 && (
                  <div className="w-px flex-grow bg-gray-600" />
                )}
              </div>
              <div className="pb-6">
                {status.text.length > 80 ? (
                  <pre className="text-gray-300 text-xs whitespace-pre-wrap bg-black/20 p-2 rounded-md border border-red-500/30 text-left overflow-x-auto">
                    {(() => {
                      try {
                        const parsed = JSON.parse(status.text);
                        return JSON.stringify(parsed, null, 2);
                      } catch {
                        return status.text;
                      }
                    })()}
                  </pre>
                ) : (
                  <p className="text-gray-200">{status.text}</p>
                )}
                {status.explorers?.map((explorer, i) => (
                  <div key={i}>
                    <a
                      href={explorer.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:underline mt-1 inline-flex items-center gap-1"
                    >
                      View {explorer.network} Transaction ↗
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {isComplete && (
          <div className="mt-4 text-center border-t border-gray-700 pt-4">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold cursor-pointer"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatusModal;
