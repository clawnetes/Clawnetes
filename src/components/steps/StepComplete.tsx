import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/shell";
import { useWizard } from "../../context/WizardContext";
import { shouldShowTelegramPairing, getTelegramPairingDisplayCode, shouldShowWhatsAppPairing } from "../../utils/messagingPairing";
import type { DeferredOAuthItem } from "../../utils/providerAuth";

interface StepCompleteProps {
  handleToggleTunnel: () => void;
  handlePairing: () => void;
  handleAdvancedTransition: () => void;
  runDeferredOAuthQueue: () => Promise<void>;
  deferredOAuthQueue: DeferredOAuthItem[];
}

export default function StepComplete({ handleToggleTunnel, handlePairing, handleAdvancedTransition, runDeferredOAuthQueue, deferredOAuthQueue }: StepCompleteProps) {
  const { state, dispatch } = useWizard();
  const {
    targetEnvironment, remoteIp, remoteUser, remotePassword, remotePrivateKeyPath,
    tunnelActive, mode, dashboardUrl, messagingChannel, isPaired, pairingCode,
    telegramToken, pairingInput, pairingStatus, licenseStatusLoaded,
    whatsappPaired, whatsappPhoneNumber, whatsappPhoneSubmitted,
    whatsappQrStep, whatsappQrLoading, whatsappQrDataUrl,
    oauthCompletionResults, oauthCompletionRunning,
    gatewayPort,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view" data-testid="step-complete">
      <h2>Setup Complete! 🦞</h2>
      <p className="step-description">
        OpenClaw is running {targetEnvironment === "cloud" ? `on ${remoteIp}` : "locally"} and ready for your commands.
      </p>

      {targetEnvironment === "cloud" && (
        <div style={{
          padding: "1rem",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderRadius: "8px",
          marginBottom: "1.5rem",
          border: "1px solid rgba(59, 130, 246, 0.3)"
        }}>
          <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--primary)" }}>
            {tunnelActive ? "🔒 SSH Tunnel Active" : "⚠️ Tunnel Inactive"}
          </h4>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
            {tunnelActive
              ? `Remote gateway (${remoteIp}:18789) is forwarded to localhost:18789`
              : "SSH tunnel is not active"}
          </p>
          {tunnelActive ? (
            <button
              className="secondary"
              style={{ marginTop: "1rem", width: "100%" }}
              onClick={async () => {
                try {
                  await invoke("stop_ssh_tunnel");
                  setField("tunnelActive", false);
                } catch (e) {
                  console.error("Failed to stop tunnel:", e);
                }
              }}
            >
              Stop SSH Tunnel
            </button>
          ) : (
            <button
              className="primary"
              style={{ marginTop: "1rem", width: "100%" }}
              onClick={() => handleToggleTunnel()}
            >
              Establish SSH Tunnel
            </button>
          )}
        </div>
      )}

      {deferredOAuthQueue.length > 0 && (
        <div style={{
          padding: "1rem",
          backgroundColor: "var(--bg-card)",
          borderRadius: "8px",
          marginBottom: "1.5rem",
          border: "1px solid var(--border)"
        }}>
          <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Deferred OpenClaw Authentication</h3>
          <p className="step-description" style={{ marginBottom: "0.75rem" }}>
            OpenClaw is installed. Clawnetes will open a terminal for each OAuth provider, replace any stale OpenClaw callback session on the known localhost port, and then sync the imported profile back into the app.
          </p>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {deferredOAuthQueue.map(item => {
              const result = oauthCompletionResults[item.id];
              const status = result?.status || (oauthCompletionRunning ? "pending" : "pending");
              const color = status === "success" ? "var(--success)" : status === "error" ? "var(--danger, #dc2626)" : "var(--text-muted)";
              return (
                <div key={item.id} style={{ padding: "0.75rem", border: "1px solid var(--border)", borderRadius: "8px" }}>
                  <div style={{ fontWeight: 600 }}>{item.label}</div>
                  <div style={{ fontSize: "0.85rem", color }}>
                    {result?.message || (oauthCompletionRunning ? "Waiting for terminal authentication..." : "Pending terminal authentication")}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            className="secondary"
            style={{ width: "100%", marginTop: "1rem" }}
            disabled={oauthCompletionRunning}
            onClick={() => {
              runDeferredOAuthQueue().catch((e) => {
                console.error("Deferred OAuth retry failed:", e);
                setField("oauthCompletionRunning", false);
              });
            }}
          >
            {oauthCompletionRunning ? "Running OpenClaw Authentication..." : "Retry Deferred OAuth"}
          </button>
        </div>
      )}

      <div className="pairing-result">
        {shouldShowTelegramPairing(messagingChannel, isPaired) && (
          <>
            <h3>Telegram Pairing</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.5rem" }}>
              Send any message to your bot to receive your code.
            </p>
            <div className="pairing-code-display">{getTelegramPairingDisplayCode(pairingCode)}</div>

            {telegramToken && (
              <div className="form-group" style={{ marginTop: "2rem" }}>
                <input
                  type="text"
                  placeholder="Enter code (e.g. 3RQ8EBFE)"
                  value={pairingInput}
                  onChange={(e) => setField("pairingInput", e.target.value.toUpperCase())}
                  style={{ textAlign: "center", letterSpacing: "2px", fontWeight: "bold" }}
                />
                <button className="primary" style={{ width: "100%", marginTop: "1rem" }} onClick={handlePairing} disabled={!pairingInput || pairingStatus === "Verifying..."}>
                  {pairingStatus === "Verifying..." ? "Verifying..." : "Pair Agent"}
                </button>
                {pairingStatus && (
                  <p style={{ marginTop: "1rem", fontWeight: "bold", color: pairingStatus.includes("Error") ? "var(--error)" : "var(--success)" }}>
                    {pairingStatus}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* WhatsApp QR Pairing */}
        {shouldShowWhatsAppPairing(messagingChannel, whatsappPaired) && (
          <div style={{ marginTop: "2rem", padding: "1.5rem", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>WhatsApp Pairing</h3>
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
              Link your WhatsApp account to enable the WhatsApp channel.
            </p>
            {!whatsappPhoneSubmitted ? (
              <div>
                <label style={{ fontSize: "0.9rem", marginBottom: "0.5rem", display: "block" }}>Your WhatsApp Phone Number</label>
                <input
                  type="tel"
                  placeholder="+1234567890"
                  value={whatsappPhoneNumber}
                  onChange={(e) => setField("whatsappPhoneNumber", e.target.value)}
                  style={{ marginBottom: "0.75rem" }}
                />
                <p className="input-hint">Include country code, e.g. +1234567890.</p>
                <button
                  className="primary"
                  style={{ width: "100%" }}
                  disabled={!whatsappPhoneNumber.trim()}
                  onClick={() => setField("whatsappPhoneSubmitted", true)}
                >
                  Continue
                </button>
              </div>
            ) : !whatsappQrStep ? (
              <button
                className="primary"
                style={{ width: "100%" }}
                disabled={whatsappQrLoading}
                onClick={async () => {
                  setField("whatsappQrLoading", true);
                  setField("whatsappQrStep", true);
                  try {
                    const remoteArg = targetEnvironment === "cloud" ? { ip: remoteIp, user: remoteUser, password: remotePassword || null, privateKeyPath: remotePrivateKeyPath || null } : null;
                    const qrDataUrl: string = await invoke("start_whatsapp_login", { gatewayPort, remote: remoteArg });
                    setField("whatsappQrDataUrl", qrDataUrl);
                    await invoke("wait_whatsapp_login", { gatewayPort, remote: remoteArg });
                    setField("whatsappQrDataUrl", "");
                    setField("whatsappPaired", true);
                    invoke("restart_openclaw_gateway", { remote: remoteArg })
                      .catch(console.error);
                  } catch (err) {
                    console.error(err);
                    alert("WhatsApp pairing error: " + err);
                    setField("whatsappQrDataUrl", "");
                    setField("whatsappQrStep", false);
                  }
                  setField("whatsappQrLoading", false);
                }}
              >
                {whatsappQrLoading ? "Connecting to gateway (may take ~30s)..." : "Start WhatsApp Pairing"}
              </button>
            ) : (
              <div style={{ textAlign: "center" }}>
                {whatsappQrDataUrl ? (
                  <>
                    <img
                      src={whatsappQrDataUrl}
                      alt="WhatsApp QR Code"
                      style={{ width: "220px", height: "220px", borderRadius: "8px", marginBottom: "1rem" }}
                    />
                    <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      Open WhatsApp &rarr; Linked Devices &rarr; Link a Device &rarr; Scan this QR
                    </p>
                    <button
                      className="secondary"
                      style={{ marginTop: "0.5rem" }}
                      onClick={async () => {
                        try {
                          const remoteArg = targetEnvironment === "cloud" ? { ip: remoteIp, user: remoteUser, password: remotePassword || null, privateKeyPath: remotePrivateKeyPath || null } : null;
                          const qrDataUrl: string = await invoke("start_whatsapp_login", { gatewayPort, remote: remoteArg });
                          setField("whatsappQrDataUrl", qrDataUrl);
                          await invoke("wait_whatsapp_login", { gatewayPort, remote: remoteArg });
                          setField("whatsappQrDataUrl", "");
                          setField("whatsappPaired", true);
                          invoke("restart_openclaw_gateway", { remote: remoteArg })
                            .catch(console.error);
                        } catch (err) {
                          console.error(err);
                          alert("WhatsApp pairing error: " + err);
                          setField("whatsappQrDataUrl", "");
                        }
                      }}
                    >
                      Refresh QR
                    </button>
                  </>
                ) : (
                  <p style={{ color: "var(--text-muted)" }}>Waiting for QR code from gateway...</p>
                )}
              </div>
            )}
          </div>
        )}

        {messagingChannel === "whatsapp" && whatsappPaired && (
          <div style={{ marginTop: "1rem", padding: "1rem", background: "rgba(34, 197, 94, 0.1)", border: "1px solid var(--success)", borderRadius: "8px", textAlign: "center" }}>
            <p style={{ color: "var(--success)", fontWeight: 600, margin: 0 }}>WhatsApp linked successfully!</p>
          </div>
        )}

        {true && (
          <div className="advanced-setup-prompt" style={{ marginTop: "2rem", padding: "1.5rem", backgroundColor: "rgba(59, 130, 246, 0.1)", borderRadius: "12px", border: "1px solid var(--primary)" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Configuration Complete</h3>
            {mode !== "advanced" ? (
              <>
                <p style={{ marginBottom: "0.75rem", fontSize: "1rem" }}>Your agent is live. But right now, it's a solo worker.</p>
                <p style={{ marginBottom: "1rem", fontSize: "1.05rem", fontWeight: 600 }}>Give it a team.</p>
                <p style={{ marginBottom: "1rem", fontSize: "0.9rem", lineHeight: "1.7", color: "var(--text-main)" }}>
                  Deploy a fleet of specialized AI agents that research, write, code, manage email, track tasks, and handle customers — all working together, 24/7, while you focus on what matters.
                </p>
                <div style={{ marginBottom: "1.25rem", fontSize: "0.85rem", lineHeight: "2", color: "var(--text-muted)" }}>
                  <div>Multi-agent teams &bull; 40+ integrations &bull; Scheduled automations</div>
                  <div>CRM, support, social media &bull; Smart failover &bull; Security controls</div>
                </div>
              </>
            ) : (
              <p style={{ marginBottom: "1.5rem" }}>Your agent is paired and ready.</p>
            )}
            <div className="button-group" style={{ gap: "1rem" }}>
              <button className="primary" data-testid="btn-open-dashboard" onClick={() => open(dashboardUrl)}>
                Open Web Dashboard
              </button>
              {mode !== "advanced" && (
                <button className="secondary" data-testid="btn-advanced-settings" onClick={handleAdvancedTransition} disabled={!licenseStatusLoaded}>
                  {licenseStatusLoaded ? "Continue to Advanced Settings" : "Checking license..."}
                </button>
              )}
              <button className="secondary" onClick={() => invoke("close_app")}>
                Exit Setup
              </button>
            </div>
            <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); open("https://aimodelscompass.gumroad.com/l/clawnetes-license"); }}
                style={{ color: "var(--text-muted)", fontSize: "0.9rem", textDecoration: "underline", cursor: "pointer" }}
              >
                If you find OpenClaw useful, please consider making a small donation to support development.
              </a>
            </div>
          </div>
        )}
      </div>

      {false && (
        <div className="button-group" style={{ flexDirection: "column", gap: "10px" }}>
          <button className="primary" style={{ width: "100%" }} onClick={() => open(dashboardUrl)}>
            Open Web Dashboard {targetEnvironment === "cloud" && "(via Tunnel)"}
          </button>
          <button className="secondary" style={{ width: "100%" }} onClick={() => invoke("close_app")}>Exit Setup</button>
        </div>
      )}
      <p style={{ marginTop: "2rem", fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "center" }}>
        Terminal access: <code>openclaw tui</code> {targetEnvironment === "cloud" && `(SSH to ${remoteIp})`}
      </p>
    </div>
  );
}
