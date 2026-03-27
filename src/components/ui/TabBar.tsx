import { memo } from "react";

export interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

function TabBar({ tabs, activeTab, onTabChange, className = "" }: TabBarProps) {
  return (
    <div className={`flex gap-0.5 border-b border-border overflow-x-auto ${className}`} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors duration-150 ${
            activeTab === tab.id
              ? "border-accent text-accent"
              : "border-transparent text-t-muted hover:text-t-main hover:bg-surface-hover"
          }`}
        >
          {tab.icon && <span className="w-3.5 h-3.5">{tab.icon}</span>}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default memo(TabBar);
