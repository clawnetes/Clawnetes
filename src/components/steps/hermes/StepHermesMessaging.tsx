import { useWizard } from "../../../context/WizardContext";
import Dropdown from "../../Dropdown";
import { TEXT_ENTRY_PROPS } from "../../ui/textEntryProps";

export default function StepHermesMessaging() {
  const { state, dispatch } = useWizard();
  const {
    loading,
    messagingChannel,
    telegramToken,
    whatsappDmPolicy,
    whatsappPhoneNumber,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as never, value });

  return (
    <div className="step-view" data-testid="step-hermes-messaging">
      <h2>Hermes Messaging</h2>
      <p className="step-description">
        Optional messaging adapters are configured here. Telegram and WhatsApp stay platform-scoped inside the active Hermes environment.
      </p>

      <div className="form-group">
        <label>Primary Channel</label>
        <Dropdown
          testId="dropdown-hermes-channel"
          value={messagingChannel}
          onChange={(nextChannel) => setField("messagingChannel", nextChannel)}
          options={[
            { value: "telegram", label: "Telegram", description: "Enable Hermes Telegram bot support" },
            { value: "whatsapp", label: "WhatsApp", description: "Enable Hermes WhatsApp pairing" },
            { value: "none", label: "No Messaging", description: "Skip messaging setup for now" },
          ]}
        />
      </div>

      {messagingChannel === "telegram" && (
        <div className="form-group" style={{ marginTop: "1rem" }}>
          <label>Telegram Bot Token</label>
          <input
            {...TEXT_ENTRY_PROPS}
            type="password"
            data-testid="input-hermes-telegram-token"
            placeholder="123456:ABC-..."
            value={telegramToken}
            onChange={(event) => setField("telegramToken", event.target.value)}
          />
        </div>
      )}

      {messagingChannel === "whatsapp" && (
        <>
          <div className="form-group" style={{ marginTop: "1rem" }}>
            <label>WhatsApp DM Policy</label>
            <Dropdown
              value={whatsappDmPolicy}
              onChange={(nextPolicy) => setField("whatsappDmPolicy", nextPolicy)}
              options={[
                { value: "allowlist", label: "Allowlist", description: "Only approved numbers can interact with Hermes" },
                { value: "open", label: "Open", description: "Allow any WhatsApp user to interact with Hermes" },
              ]}
            />
          </div>

          <div className="form-group" style={{ marginTop: "1rem" }}>
            <label>Allowed WhatsApp Number</label>
            <input
              {...TEXT_ENTRY_PROPS}
              type="text"
              data-testid="input-hermes-whatsapp-phone"
              placeholder="+1234567890"
              value={whatsappPhoneNumber}
              onChange={(event) => setField("whatsappPhoneNumber", event.target.value)}
            />
          </div>
        </>
      )}

      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" data-testid="btn-next" onClick={() => setField("step", 21)} disabled={loading}>
          Next
        </button>
        <button className="secondary" onClick={() => setField("step", 19)} disabled={loading}>
          Back
        </button>
      </div>
    </div>
  );
}
