import { useState, useRef, useEffect } from "react";
import type { DropdownOption } from "../types";

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  searchable?: boolean;
  maxHeight?: number;
  testId?: string;
}

export default function Dropdown({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchable = false,
  maxHeight = 260,
  testId,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // Focus search input when opening
  useEffect(() => {
    if (open && searchable && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open, searchable]);

  const selected = options.find((o) => o.value === value);

  const filtered = searchable && search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          (o.description && o.description.toLowerCase().includes(search.toLowerCase()))
      )
    : options;

  return (
    <div className="dropdown-container" ref={containerRef} data-testid={testId}>
      <button
        type="button"
        className={`dropdown-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className="dropdown-trigger-content">
          {selected ? (
            <>
              {selected.emoji && <span className="dropdown-emoji">{selected.emoji}</span>}
              {selected.icon && (
                <img src={selected.icon} alt="" className="dropdown-icon" />
              )}
              <span>{selected.label}</span>
            </>
          ) : (
            <span className="dropdown-placeholder">{placeholder}</span>
          )}
        </span>
        <svg
          className={`dropdown-chevron ${open ? "rotated" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="dropdown-panel" style={{ maxHeight }}>
          {searchable && (
            <div className="dropdown-search-wrap">
              <input
                ref={searchRef}
                type="text"
                className="dropdown-search"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
          <div className="dropdown-options">
            {filtered.length === 0 && (
              <div className="dropdown-empty">No results found</div>
            )}
            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`dropdown-option ${opt.value === value ? "selected" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <span className="dropdown-option-content">
                  {opt.emoji && <span className="dropdown-emoji">{opt.emoji}</span>}
                  {opt.icon && (
                    <img src={opt.icon} alt="" className="dropdown-icon" />
                  )}
                  <span className="dropdown-option-text">
                    <span className="dropdown-option-label">{opt.label}</span>
                    {opt.description && (
                      <span className="dropdown-option-desc">{opt.description}</span>
                    )}
                  </span>
                </span>
                {opt.value === value && (
                  <svg className="dropdown-check" width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7L6 10L11 4" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
