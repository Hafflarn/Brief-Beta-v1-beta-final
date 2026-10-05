"use client";
import { useId } from "react";

/** A labelled, keyboard-accessible upload control shared by both diaries. */
export default function FilePicker({ files, onChange, disabled = false, label = "Bilagor" }: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const help = useId();
  return <div className="file-picker">
    <label className="file-picker-target">
      <span className="file-picker-title">{label}</span>
      <span className="file-picker-button">Välj bilder eller dokument</span>
      <input type="file" multiple disabled={disabled} aria-describedby={help}
        accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
        onChange={e => onChange(Array.from(e.target.files || []))} />
    </label>
    <small id={help} className="muted">Högst 5 filer, max 10 MB per fil.</small>
    {!!files.length && <ul className="selected-files" aria-label="Valda filer">{files.map((file, index) =>
      <li key={`${file.name}-${index}`}><span>{file.name}</span><small>{new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 }).format(file.size / 1024)} kB</small></li>
    )}</ul>}
  </div>;
}
