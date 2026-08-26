"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const COMPONENTS = [
  {
    id: "web",
    short: "WEB",
    name: "Application Web",
    role: "Starts the request",
    zone: "Browser",
    description: "The Angular portal collects the user action and calls the BFF on its configured localhost or deployed URL.",
    check: "Verify the Web config points to the BFF port and the BFF allows the Web origin.",
    owns: "User interaction, request payload, user session"
  },
  {
    id: "bff",
    short: "BFF",
    name: "Application BFF",
    role: "Validates the user",
    zone: "Edge",
    description: "The backend-for-frontend accepts the portal OAuth user token, validates it, and prepares the downstream service call.",
    check: "Use a user token here. A service token may be valid but is the wrong token type for this boundary.",
    owns: "User-token validation, CORS, downstream call"
  },
  {
    id: "api",
    short: "API",
    name: "Application API",
    role: "Handles application work",
    zone: "Service",
    description: "The API accepts a service-to-service bearer token and coordinates the application request with the orchestrator.",
    check: "Confirm client ID, client secret, audience, token URL, and the API's expected audience.",
    owns: "Application contract, validation, orchestration call"
  },
  {
    id: "orch",
    short: "ORCH",
    name: "Application Orchestrator",
    role: "Coordinates the workflow",
    zone: "Service",
    description: "The orchestrator executes the multi-service workflow. A successful call can still be incomplete if an expected downstream result is absent.",
    check: "Search the orchestrator logs with the same application ID or trace ID used in the API logs.",
    owns: "Workflow state, downstream coordination, Kafka event"
  },
  {
    id: "kafka",
    short: "KFK",
    name: "Kafka Broker",
    role: "Carries async events",
    zone: "Event",
    description: "Kafka separates the synchronous request from background processing. The broker must be running and advertised on a reachable listener.",
    check: "Run docker ps, verify the Kafka container, then compare advertised listeners with the Event Parser connection string.",
    owns: "Topics, event delivery, consumer offsets"
  },
  {
    id: "parser",
    short: "EVT",
    name: "Application Event Parser",
    role: "Consumes the event",
    zone: "Worker",
    description: "The Event Parser listens to Kafka, parses the application event, and runs background updates after the API response path.",
    check: "Look for the listening/consumer-ready log before testing. No listener means the request can succeed while the event is never processed.",
    owns: "Event consumption, parsing, background update"
  },
  {
    id: "splunk",
    short: "LOG",
    name: "Splunk",
    role: "Correlates the evidence",
    zone: "Observe",
    description: "Splunk brings API, orchestrator, and worker logs together using one trace ID or application UUID.",
    check: "Use app IN (Application API app ID, Orchestrator app ID) and filter by the UUID alone when a copied field is too specific.",
    owns: "Logs, cross-service correlation, failure evidence"
  }
];

const SCENARIOS = {
  happy: {
    label: "Healthy request",
    summary: "The synchronous call returns, Kafka accepts the event, and the parser consumes it.",
    stop: null,
    severity: "healthy"
  },
  userToken: {
    label: "Wrong user token",
    summary: "The request stops at the BFF before any service-to-service call is made.",
    stop: "bff",
    severity: "error"
  },
  serviceToken: {
    label: "Service token rejected",
    summary: "The BFF is reached, but the Application API rejects its downstream token.",
    stop: "api",
    severity: "error"
  },
  kafkaDown: {
    label: "Kafka unavailable",
    summary: "The API path can look successful, while the asynchronous event fails at the broker.",
    stop: "kafka",
    severity: "warning"
  },
  creditMissing: {
    label: "Credit result missing",
    summary: "The orchestrator call succeeds, but the expected credit result is not present in the returned workflow data.",
    stop: "orch",
    severity: "warning"
  }
};

const TRACE_STEPS = [
  { component: "web", event: "POST /applications", detail: "Portal sends form data with the OAuth user token." },
  { component: "bff", event: "Validate user token", detail: "BFF checks issuer, audience, expiry, and allowed origin." },
  { component: "api", event: "Call Application API", detail: "BFF exchanges context for a service-to-service bearer token." },
  { component: "orch", event: "Execute workflow", detail: "Orchestrator coordinates application and credit work." },
  { component: "kafka", event: "Publish application event", detail: "Workflow result is placed on the configured topic." },
  { component: "parser", event: "Consume and parse", detail: "Event Parser receives the message and performs background work." },
  { component: "splunk", event: "Correlate logs", detail: "The same trace ID ties the request together across services." }
];

const TROUBLESHOOTING = [
  {
    id: "401-bff",
    label: "401 at BFF",
    signal: "The API has no matching request log.",
    checks: ["Confirm this is a portal user token", "Check token issuer, audience, and expiry", "Verify Web origin is allowed by BFF", "Confirm Web points to the active BFF port"],
    query: "Start in browser Network → BFF logs"
  },
  {
    id: "401-api",
    label: "401 at API",
    signal: "BFF logs a downstream unauthorized response.",
    checks: ["Request a service token, not a user token", "Check client ID and client secret source", "Match audience to Application API", "Verify local/test app settings override the root correctly"],
    query: "BFF trace ID → Application API logs"
  },
  {
    id: "no-credit",
    label: "No credit result",
    signal: "Application request succeeds, but credit data is absent.",
    checks: ["Capture the application UUID", "Search both API and Orchestrator app IDs", "Inspect the orchestrator response payload", "Verify the credit call was invoked and returned"],
    query: "app IN (API_APP_ID, ORCH_APP_ID) \"<application-uuid>\""
  },
  {
    id: "no-event",
    label: "Event not processed",
    signal: "The synchronous response succeeds; no worker-side update follows.",
    checks: ["Confirm Kafka appears in docker ps", "Verify advertised listener and broker URL", "Look for Event Parser consumer-ready log", "Check topic name, consumer group, and offset"],
    query: "Kafka container → Event Parser logs → topic offsets"
  },
  {
    id: "connection",
    label: "Local connection error",
    signal: "A service fails before an application response exists.",
    checks: ["Run every required local service", "Use local environment settings, not test URLs", "Compare ports across Web, BFF, and APIs", "Check Redis, Kafka, and database containers"],
    query: "docker ps → appsettings.Local → startup logs"
  }
];

function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  const paths = {
    play: <><polygon points="7 4 20 12 7 20 7 4" /></>,
    step: <><polygon points="5 4 16 12 5 20 5 4" /><path d="M19 5v14" /></>,
    reset: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v6h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="M12 3 2.7 20h18.6L12 3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    activity: <><path d="M3 12h4l2-6 4 12 2-6h6" /></>
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function FlowNode({ component, state, onClick, isSelected }) {
  return (
    <button className={`flow-node ${state} ${isSelected ? "selected" : ""}`} onClick={() => onClick(component.id)} aria-label={`Inspect ${component.name}`}>
      <span className="node-state"><span /></span>
      <span className="node-mark">{component.short}</span>
      <span className="node-copy"><strong>{component.name}</strong><small>{component.role}</small></span>
      <span className="node-chevron">›</span>
    </button>
  );
}

export default function Home() {
  const [selected, setSelected] = useState("bff");
  const [scenario, setScenario] = useState("happy");
  const [traceIndex, setTraceIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [symptom, setSymptom] = useState("no-credit");
  const [checked, setChecked] = useState({});
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const traceId = "trc_9f2a7c81";
  const applicationId = "b63fd17e-2c64-4db6";

  const selectedComponent = COMPONENTS.find((item) => item.id === selected);
  const selectedTrouble = TROUBLESHOOTING.find((item) => item.id === symptom);
  const stopIndex = SCENARIOS[scenario].stop ? TRACE_STEPS.findIndex((step) => step.component === SCENARIOS[scenario].stop) : TRACE_STEPS.length - 1;

  useEffect(() => {
    if (!running) return;
    timer.current = window.setTimeout(() => {
      setTraceIndex((current) => {
        if (current >= stopIndex) {
          setRunning(false);
          return current;
        }
        return current + 1;
      });
    }, 680);
    return () => window.clearTimeout(timer.current);
  }, [running, traceIndex, stopIndex]);

  useEffect(() => {
    setTraceIndex(-1);
    setRunning(false);
  }, [scenario]);

  const states = useMemo(() => {
    const result = {};
    COMPONENTS.forEach((item) => { result[item.id] = "idle"; });
    TRACE_STEPS.forEach((step, index) => {
      if (index < traceIndex) result[step.component] = "done";
      if (index === traceIndex) result[step.component] = index === stopIndex && SCENARIOS[scenario].stop ? SCENARIOS[scenario].severity : "active";
    });
    return result;
  }, [traceIndex, scenario, stopIndex]);

  const run = () => {
    if (traceIndex >= stopIndex) setTraceIndex(-1);
    setRunning(true);
  };

  const step = () => {
    setRunning(false);
    setTraceIndex((current) => current >= stopIndex ? -1 : current + 1);
  };

  const reset = () => {
    setRunning(false);
    setTraceIndex(-1);
  };

  const copyQuery = async () => {
    try {
      await navigator.clipboard.writeText(selectedTrouble.query);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#flow" aria-label="Backend Request Flow Lab home"><span className="brand-mark"><Icon name="activity" size={19} /></span><span>Request Flow <em>Lab</em></span></a>
        <nav><a href="#flow">Trace</a><a href="#auth">Auth</a><a href="#troubleshoot">Troubleshoot</a></nav>
        <span className="private-pill"><Icon name="lock" size={14} /> Private workspace</span>
      </header>

      <section className="hero" id="flow">
        <div className="hero-copy">
          <span className="eyebrow">APPLICATION PLATFORM · INTERACTIVE MAP</span>
          <h1>See where a request goes.<br /><span>Know where it broke.</span></h1>
          <p>Run a request from the portal through the synchronous API path and asynchronous event pipeline. Click any component to inspect its responsibility.</p>
        </div>
        <div className="hero-metric"><span>Flow coverage</span><strong>7</strong><small>connected components</small></div>

        <div className="lab-shell">
          <div className="lab-toolbar">
            <div className="scenario-control">
              <label htmlFor="scenario">Scenario</label>
              <select id="scenario" value={scenario} onChange={(e) => setScenario(e.target.value)}>
                {Object.entries(SCENARIOS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
              </select>
            </div>
            <div className="trace-meta"><span><i className="live-dot" /> Trace ready</span><code>{traceId}</code></div>
            <div className="run-controls">
              <button className="icon-button" onClick={reset} aria-label="Reset trace" title="Reset"><Icon name="reset" /></button>
              <button className="icon-button" onClick={step} aria-label="Step through trace" title="Step"><Icon name="step" /></button>
              <button className="run-button" onClick={run} disabled={running}><Icon name="play" size={16} /> {running ? "Running" : "Run request"}</button>
            </div>
          </div>

          <div className="lab-grid">
            <div className="flow-column">
              <div className="flow-heading"><span>Request path</span><small>Click to inspect</small></div>
              <div className="flow-list">
                {COMPONENTS.slice(0, 6).map((component, index) => (
                  <div className="flow-item" key={component.id}>
                    <FlowNode component={component} state={states[component.id]} onClick={setSelected} isSelected={selected === component.id} />
                    {index < 5 && <div className={`connector ${traceIndex > index ? "lit" : ""}`}><span /></div>}
                  </div>
                ))}
              </div>
              <div className="observe-rail">
                <span>observability</span>
                <FlowNode component={COMPONENTS[6]} state={states.splunk} onClick={setSelected} isSelected={selected === "splunk"} />
              </div>
            </div>

            <aside className="inspector">
              <div className="inspector-head"><span className="inspector-mark">{selectedComponent.short}</span><div><small>{selectedComponent.zone} boundary</small><h2>{selectedComponent.name}</h2></div></div>
              <p>{selectedComponent.description}</p>
              <div className="detail-block"><span>Owns</span><strong>{selectedComponent.owns}</strong></div>
              <div className="check-callout"><Icon name="search" /><div><span>First thing to check</span><p>{selectedComponent.check}</p></div></div>
              <div className="active-trace">
                <div className="active-head"><span>Live trace</span><small>{traceIndex < 0 ? "Waiting" : `${Math.min(traceIndex + 1, TRACE_STEPS.length)} / ${TRACE_STEPS.length}`}</small></div>
                {traceIndex < 0 ? (
                  <div className="trace-empty"><span className="pulse-ring" /><p>Choose a scenario, then run or step through it.</p></div>
                ) : (
                  <div className={`trace-event ${traceIndex === stopIndex && SCENARIOS[scenario].stop ? SCENARIOS[scenario].severity : ""}`}>
                    <span className="event-status">{traceIndex === stopIndex && SCENARIOS[scenario].stop ? <Icon name="alert" /> : <Icon name="check" />}</span>
                    <div><strong>{TRACE_STEPS[traceIndex].event}</strong><p>{traceIndex === stopIndex && SCENARIOS[scenario].stop ? SCENARIOS[scenario].summary : TRACE_STEPS[traceIndex].detail}</p><code>{traceId} · +{(traceIndex * 84 + 31)}ms</code></div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="auth-section" id="auth">
        <div className="section-heading"><span className="eyebrow">AUTHENTICATION BOUNDARIES</span><h2>Two tokens. Two different jobs.</h2><p>The token changes when the request crosses from a person using the portal to one service calling another.</p></div>
        <div className="token-map">
          <article className="token-card user-token">
            <div className="token-top"><span className="token-icon"><Icon name="lock" /></span><span className="token-type">USER TOKEN</span></div>
            <h3>Portal → BFF</h3><p>Represents the signed-in person. It comes from portal OAuth and is accepted at the BFF boundary.</p>
            <dl><div><dt>Subject</dt><dd>User identity</dd></div><div><dt>Check</dt><dd>Issuer · audience · expiry</dd></div></dl>
          </article>
          <div className="token-exchange"><span><Icon name="arrow" /></span><strong>Context changes here</strong><small>The BFF makes a downstream service call</small></div>
          <article className="token-card service-token">
            <div className="token-top"><span className="token-icon"><Icon name="lock" /></span><span className="token-type">SERVICE TOKEN</span></div>
            <h3>BFF → API → Orchestrator</h3><p>Represents the calling service. It is issued from a client ID, secret, audience, and token URL.</p>
            <dl><div><dt>Subject</dt><dd>Service identity</dd></div><div><dt>Check</dt><dd>Client · secret · audience</dd></div></dl>
          </article>
        </div>
        <div className="rule-strip"><Icon name="alert" /><span><strong>Fast rule:</strong> If the BFF rejects the call, inspect the user token. If the API rejects the BFF, inspect the service token.</span></div>
      </section>

      <section className="trouble-section" id="troubleshoot">
        <div className="section-heading"><span className="eyebrow">TROUBLESHOOTING WORKBENCH</span><h2>Start from the symptom.</h2><p>Pick what you can observe. The workbench narrows the first checks and the evidence trail to follow.</p></div>
        <div className="trouble-layout">
          <div className="symptom-list" role="tablist" aria-label="Troubleshooting symptoms">
            {TROUBLESHOOTING.map((item) => <button key={item.id} role="tab" aria-selected={symptom === item.id} className={symptom === item.id ? "active" : ""} onClick={() => { setSymptom(item.id); setChecked({}); }}><span>{item.label}</span><small>{item.signal}</small><b>›</b></button>)}
          </div>
          <article className="trouble-card">
            <div className="trouble-title"><span className="status-badge">DIAGNOSTIC PATH</span><h3>{selectedTrouble.label}</h3><p>{selectedTrouble.signal}</p></div>
            <div className="checklist">
              {selectedTrouble.checks.map((item, index) => <button key={item} onClick={() => setChecked((current) => ({ ...current, [index]: !current[index] }))} className={checked[index] ? "done" : ""}><span className="check-box">{checked[index] && <Icon name="check" size={15} />}</span><span>{item}</span></button>)}
            </div>
            <div className="evidence-box"><div><span>Evidence path</span><code>{selectedTrouble.query}</code></div><button onClick={copyQuery} aria-label="Copy evidence path"><Icon name={copied ? "check" : "copy"} />{copied ? "Copied" : "Copy"}</button></div>
            <div className="identity-row"><span>Example application UUID</span><code>{applicationId}</code></div>
          </article>
        </div>
      </section>

      <footer><span>Backend Request Flow Lab</span><p>Built as a learning and debugging companion · Example IDs only</p><a href="#flow">Back to trace ↑</a></footer>
    </main>
  );
}
