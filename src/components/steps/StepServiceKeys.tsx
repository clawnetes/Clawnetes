import { useWizard } from "../../context/WizardContext";
import Dropdown from "../Dropdown";

const SERVICES_TO_CONFIGURE = [
  { id: "goplaces", name: "Google Places", placeholder: "API Key" },
  { id: "notion", name: "Notion", placeholder: "Internal Integration Token" },
  { id: "elevenlabs", name: "ElevenLabs (SAG)", placeholder: "API Key" },
  { id: "nano-banana", name: "Nano Banana Pro", placeholder: "API Key" },
  { id: "openai-images", name: "OpenAI Image Gen", placeholder: "API Key" }
];

export default function StepServiceKeys() {
  const { state, dispatch } = useWizard();
  const { serviceKeys, currentServiceIdx, isConfiguringService, mode, loading } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  const currentService = SERVICES_TO_CONFIGURE[currentServiceIdx];

  return (
    <div className="step-view">
      <h2>Service Key: {currentService.name}</h2>
      <p className="step-description">Would you like to provide a key for this optional service now?</p>

      <div style={{ marginBottom: "2rem" }}>
        <Dropdown
          value={isConfiguringService === true ? "yes" : "no"}
          onChange={(val) => setField("isConfiguringService", val === "yes")}
          options={[
            { value: "yes", label: "Yes", description: `Configure ${currentService.name} now.` },
            { value: "no", label: "Skip", description: "I'll configure this later in the dashboard." }
          ]}
        />
      </div>

      {isConfiguringService === true && (
        <div className="form-group animate-fadeIn">
          <label>{currentService.name} API Key</label>
          <input
            type="password"
            autoFocus
            placeholder={currentService.placeholder}
            value={serviceKeys[currentService.id] || ""}
            onChange={(e) => setField("serviceKeys", { ...serviceKeys, [currentService.id]: e.target.value })}
            autoComplete="off"
          />
        </div>
      )}

      <div className="button-group">
        <button
          className="primary"
          disabled={isConfiguringService === true && !serviceKeys[currentService.id]}
          onClick={() => {
            const sid = currentService.id;
            const newKeys = { ...serviceKeys };
            if (!isConfiguringService) delete newKeys[sid];
            setField("serviceKeys", newKeys);

            if (currentServiceIdx < SERVICES_TO_CONFIGURE.length - 1) {
              setField("currentServiceIdx", currentServiceIdx + 1);
              setField("isConfiguringService", false);
            } else {
              if (mode === "advanced") {
                setField("step", 12);
              } else {
                setField("step", 16);
              }
            }
          }}
        >
          {currentServiceIdx < SERVICES_TO_CONFIGURE.length - 1 ? "Next Service" : (mode === "advanced" ? "Continue to Advanced Settings" : "Next")}
        </button>
        <button className="secondary" onClick={() => {
          if (currentServiceIdx > 0) {
            setField("currentServiceIdx", currentServiceIdx - 1);
            setField("isConfiguringService", serviceKeys[SERVICES_TO_CONFIGURE[currentServiceIdx - 1].id] ? true : false);
          } else {
            setField("step", 11);
          }
        }} disabled={loading}>Back</button>
      </div>
    </div>
  );
}
