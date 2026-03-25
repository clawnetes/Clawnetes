import { memo, useEffect, useMemo, useRef, useState } from "react";
import ToolPolicyEditor from "../ToolPolicyEditor";
import type { ToolPolicy } from "../../types";

interface ToolsPanelProps {
  toolPolicy: ToolPolicy;
  onSaveToolPolicy?: (policy: ToolPolicy) => void;
  saving?: boolean;
}

function ToolsPanel({ toolPolicy, onSaveToolPolicy, saving = false }: ToolsPanelProps) {
  const [draftPolicy, setDraftPolicy] = useState<ToolPolicy>(toolPolicy);

  // Re-sync draft when committed prop changes (e.g., after save)
  const prevPolicyRef = useRef(toolPolicy);
  useEffect(() => {
    if (prevPolicyRef.current !== toolPolicy) {
      setDraftPolicy(toolPolicy);
      prevPolicyRef.current = toolPolicy;
    }
  }, [toolPolicy]);

  // Check if policy has changed
  const isDirty = useMemo(() => {
    return JSON.stringify(draftPolicy) !== JSON.stringify(toolPolicy);
  }, [draftPolicy, toolPolicy]);

  const handlePolicyChange = (newPolicy: ToolPolicy) => {
    setDraftPolicy(newPolicy);
  };

  const handleSave = () => {
    onSaveToolPolicy?.(draftPolicy);
  };

  const handleCancel = () => {
    setDraftPolicy(toolPolicy);
  };

  return (
    <div data-testid="tools-panel" className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">Tool Access Policy</h3>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-4">
        <ToolPolicyEditor
          policy={draftPolicy}
          onChange={handlePolicyChange}
          title="Tool Access Policy"
          description="Choose a base profile, then enable or disable individual tools."
        />
      </div>

      {/* Save/Cancel buttons */}
      {isDirty && (
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 px-3 py-2 rounded-md bg-[var(--surface-hover)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-active)] transition-colors"
            data-testid="tools-cancel-button"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-md bg-[var(--accent)] text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity disabled:cursor-not-allowed"
            data-testid="tools-save-button"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(ToolsPanel);
