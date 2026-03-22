import { memo } from "react";
import { useWizard } from "../../context/WizardContext";
import Dropdown from "../Dropdown";

interface StepChannelsProps {
  handleAdvancedTransition: () => void;
}

function StepChannels({ handleAdvancedTransition }: StepChannelsProps) {
  const { state, dispatch } = useWizard();
  const {
    messagingChannel, telegramToken, whatsappDmPolicy, whatsappPhoneNumber,
    mode, skipBasicConfig, loading,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view" data-testid="step-channels">
      <h2>Messaging Channels</h2>
      <p className="step-description">Select a messaging channel for your agent.</p>

      <div className="form-group">
        <label>Channel</label>
        <Dropdown
          testId="dropdown-channel"
          value={messagingChannel === "none" ? "telegram" : messagingChannel}
          onChange={(v) => setField("messagingChannel", v)}
          options={[
            { value: "telegram", label: "Telegram", description: "Connect via Telegram Bot" },
            { value: "whatsapp", label: "WhatsApp", description: "Connect via WhatsApp (QR pairing at end of setup)" },
          ]}
        />
      </div>

      {messagingChannel === "telegram" && (
        <div className="form-group" style={{ marginTop: "1rem" }}>
          <label>Telegram Bot Token</label>
          <input type="password" data-testid="input-telegram-token" placeholder="123456:ABC-..." value={telegramToken} onChange={(e) => setField("telegramToken", e.target.value)} autoComplete="off" />
          <p className="input-hint">Get one from @BotFather on Telegram.</p>
        </div>
      )}

      {messagingChannel === "whatsapp" && (
        <div style={{ marginTop: "1rem" }}>
          <div className="form-group">
            <label>WhatsApp DM Policy</label>
            <Dropdown
              value={whatsappDmPolicy}
              onChange={(v) => setField("whatsappDmPolicy", v)}
              options={[
                { value: "allowlist", label: "Allowlist (Recommended)", description: "Only your number can interact with the bot" },
                { value: "open", label: "Open (Dangerous)", description: "Anyone who messages the bot can interact with it" },
              ]}
            />
            <p className="input-hint" style={{ marginTop: "0.25rem" }}>
              If you use Allowlist, enter your phone number below so the bot can reply to you.
            </p>
          </div>

          {whatsappDmPolicy === "allowlist" && (
            <div className="form-group" style={{ marginTop: "1rem" }}>
              <label>Your Phone Number (Allowlist)</label>
              <input
                type="text"
                data-testid="input-whatsapp-phone"
                placeholder="+1234567890"
                value={whatsappPhoneNumber}
                onChange={(e) => setField("whatsappPhoneNumber", e.target.value)}
                autoComplete="off"
              />
              <p className="input-hint">The phone number you will use to message the bot. Include country code.</p>
            </div>
          )}

          <p className="input-hint" style={{ marginTop: "1rem", color: "var(--text-muted)" }}>
            WhatsApp pairing will happen at the end of setup. You'll scan a QR code to link your account.
          </p>
        </div>
      )}

      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" data-testid="btn-next" onClick={() => {
          if (mode === "advanced" || skipBasicConfig) handleAdvancedTransition();
          else setField("step", 16);
        }} disabled={loading}>
          {mode === "advanced" ? "Continue" : "Next"}
        </button>
        <button className="secondary" onClick={() => setField("step", 8)} disabled={loading}>Back</button>
      </div>
    </div>
  );
}

export default memo(StepChannels);
