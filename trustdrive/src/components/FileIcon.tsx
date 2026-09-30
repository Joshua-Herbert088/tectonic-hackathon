export function FileIcon({ kind, size = 20 }: { kind: "doc" | "sheet" | "pdf"; size?: number }) {
  const color = kind === "doc" ? "#4285f4" : kind === "sheet" ? "#0f9d58" : "#ea4335";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M5 2h10l5 5v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill={color} />
      <path d="M15 2v5h5" fill="#fff" opacity=".45" />
      {kind === "doc" && <path d="M7 11h10M7 14h10M7 17h6" stroke="#fff" strokeWidth="1.5" />}
      {kind === "sheet" && <path d="M7 10h10v8H7zM7 14h10M12 10v8" stroke="#fff" strokeWidth="1.3" fill="none" />}
      {kind === "pdf" && <text x="12" y="17.5" fontSize="6.5" fill="#fff" textAnchor="middle" fontWeight="700">PDF</text>}
    </svg>
  );
}
