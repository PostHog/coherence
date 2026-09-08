// Taxonomy knowledge ported from coherence-lab/component-classifier/catalog.mjs.
// This catalog proposes obligations; it never assigns a verification verdict.
// Namespaces distinguish leaves, facets, questions and guarantee suggestions.
// The frozen lab fixture is an independent population/content parity witness.
export interface TaxonomyRole { id: string; label: string; pack: string; responsibility: string; signals: string[]; cues: string[]; tensions: string[]; requires?: string }
export interface TaxonomyQuestion { id: string; pack: string; question: string; projection: string[]; when?: string }
export interface TaxonomyFacet { id: string; pack: string; question: string }
export interface TaxonomyGuarantee { id: string; pack: string; level: string; when: string; text: string }
export interface TaxonomyCatalog { version: string; source: string; roles: TaxonomyRole[]; questions: TaxonomyQuestion[]; facets: TaxonomyFacet[]; guarantees: TaxonomyGuarantee[] }
export const LAB_TAXONOMY: TaxonomyCatalog = {
  "version": "coherence-taxonomy/v1",
  "source": "semantic-component-classifier/v3-closure",
  "roles": [
    {
      "id": "role:simulation-state-authority",
      "label": "Simulation state authority",
      "pack": "simulation",
      "responsibility": "provide the single authoritative state of a simulated system at one logical instant",
      "signals": [
        "signal:simulation-state"
      ],
      "cues": [
        "state",
        "model",
        "world",
        "planet"
      ],
      "tensions": []
    },
    {
      "id": "role:transition-process",
      "label": "Transition process",
      "pack": "simulation",
      "responsibility": "provide one causal law by which simulated state changes over a timestep",
      "signals": [
        "signal:simulation-transition"
      ],
      "cues": [
        "process",
        "rate",
        "growth",
        "decay",
        "warming"
      ],
      "tensions": []
    },
    {
      "id": "role:coupled-step-integrator",
      "label": "Coupled-step integrator",
      "pack": "simulation",
      "responsibility": "combine interacting simulation processes into one atomic transition from S_t to S_t+1",
      "signals": [
        "signal:simulation-integrator"
      ],
      "cues": [
        "advance",
        "step",
        "integrate",
        "tick"
      ],
      "tensions": []
    },
    {
      "id": "role:simulation-timebase",
      "label": "Simulation timebase",
      "pack": "simulation",
      "responsibility": "decide when and by how much logical simulation time advances",
      "signals": [
        "signal:simulation-timebase"
      ],
      "cues": [
        "pause",
        "clock",
        "time",
        "rate"
      ],
      "tensions": []
    },
    {
      "id": "role:event-disturbance-process",
      "label": "Event/disturbance process",
      "pack": "simulation",
      "responsibility": "apply a bounded discrete occurrence to simulated state at a defined cycle point",
      "signals": [
        "signal:simulation-event"
      ],
      "cues": [
        "event",
        "eruption",
        "impact",
        "shock"
      ],
      "tensions": []
    },
    {
      "id": "role:scenario-initial-condition-generator",
      "label": "Scenario/initial-condition generator",
      "pack": "simulation",
      "responsibility": "produce a complete valid starting simulated world from a scenario or seed",
      "signals": [
        "signal:simulation-scenario"
      ],
      "cues": [
        "seed",
        "scenario",
        "initial",
        "preset"
      ],
      "tensions": []
    },
    {
      "id": "role:model-parameter-authority",
      "label": "Model parameter authority",
      "pack": "simulation",
      "responsibility": "own coefficients, thresholds, and regime policy that govern model behavior",
      "signals": [
        "signal:simulation-parameters"
      ],
      "cues": [
        "parameter",
        "coefficient",
        "threshold",
        "config"
      ],
      "tensions": []
    },
    {
      "id": "role:derived-observable-projector",
      "label": "Derived observable/projector",
      "pack": "simulation",
      "responsibility": "derive a domain observation from canonical state without changing its trajectory",
      "signals": [
        "signal:simulation-observable"
      ],
      "cues": [
        "habitability",
        "observable",
        "derive",
        "project"
      ],
      "tensions": []
    },
    {
      "id": "role:trajectory-history-recorder",
      "label": "Trajectory/history recorder",
      "pack": "simulation",
      "responsibility": "retain time-indexed committed states or observations without becoming current-state authority",
      "signals": [
        "signal:simulation-trajectory"
      ],
      "cues": [
        "history",
        "trajectory",
        "series",
        "samples"
      ],
      "tensions": []
    },
    {
      "id": "role:parser",
      "label": "Parser",
      "pack": "core",
      "responsibility": "turn an input representation into a structured representation",
      "signals": [
        "signal:representation"
      ],
      "cues": [
        "parse",
        "syntax",
        "AST"
      ],
      "tensions": []
    },
    {
      "id": "role:validator-type-checker",
      "label": "Validator/type checker",
      "pack": "core",
      "responsibility": "decide whether a representation satisfies rules without becoming its runtime",
      "signals": [
        "signal:representation",
        "signal:authority"
      ],
      "cues": [
        "validate",
        "check",
        "diagnostic"
      ],
      "tensions": []
    },
    {
      "id": "role:lowerer-domain-transformer",
      "label": "Lowerer/domain transformer",
      "pack": "core",
      "responsibility": "translate one established representation into another",
      "signals": [
        "signal:representation"
      ],
      "cues": [
        "lower",
        "transform",
        "convert"
      ],
      "tensions": []
    },
    {
      "id": "role:optimizer",
      "label": "Optimizer",
      "pack": "core",
      "responsibility": "improve a representation while preserving its required meaning",
      "signals": [
        "signal:representation",
        "signal:execution"
      ],
      "cues": [
        "optimize",
        "plan",
        "rewrite"
      ],
      "tensions": []
    },
    {
      "id": "role:public-api-facade",
      "label": "Public API/facade",
      "pack": "core",
      "responsibility": "be the stable caller-facing surface for ongoing domain operations",
      "signals": [
        "signal:invocation"
      ],
      "cues": [],
      "tensions": [
        "signal:bootstrap"
      ]
    },
    {
      "id": "role:cli-orchestrator",
      "label": "CLI orchestrator",
      "pack": "core",
      "responsibility": "translate command-line intent into one bounded invocation and its exit behavior",
      "signals": [
        "signal:invocation",
        "signal:bootstrap"
      ],
      "cues": [
        "main",
        "argv",
        "command"
      ],
      "tensions": []
    },
    {
      "id": "role:bootstrap-entrypoint",
      "label": "Bootstrap/entrypoint",
      "pack": "core",
      "responsibility": "own one-time top-level initialization and application startup",
      "signals": [
        "signal:bootstrap"
      ],
      "cues": [
        "main",
        "application",
        "start"
      ],
      "tensions": []
    },
    {
      "id": "role:factory-assembler",
      "label": "Factory/assembler",
      "pack": "core",
      "responsibility": "select, configure, assemble, or return another component",
      "signals": [
        "signal:construction"
      ],
      "cues": [
        "new",
        "create",
        "build",
        "provider",
        "factory"
      ],
      "tensions": []
    },
    {
      "id": "role:plugin-extension-host",
      "label": "Plugin/extension host",
      "pack": "core",
      "responsibility": "load and invoke independently supplied implementations across a compatibility boundary",
      "signals": [
        "signal:extension"
      ],
      "cues": [],
      "tensions": [
        "signal:construction"
      ]
    },
    {
      "id": "role:runtime-executor",
      "label": "Runtime/executor",
      "pack": "core",
      "responsibility": "schedule, dispatch, execute, or supervise continuing work",
      "signals": [
        "signal:execution"
      ],
      "cues": [],
      "tensions": [
        "signal:invocation"
      ]
    },
    {
      "id": "role:session-subscription-owner",
      "label": "Session/subscription owner",
      "pack": "core",
      "responsibility": "own logical continuity, reconnect, cancellation, and termination",
      "signals": [
        "signal:continuity"
      ],
      "cues": [],
      "tensions": [
        "signal:resource"
      ]
    },
    {
      "id": "role:resource-driver",
      "label": "Resource driver",
      "pack": "core",
      "responsibility": "own operations and failures of an external resource or process substrate",
      "signals": [
        "signal:resource"
      ],
      "cues": [],
      "tensions": [
        "signal:continuity"
      ]
    },
    {
      "id": "role:ui-controller",
      "label": "UI controller",
      "pack": "core",
      "responsibility": "coordinate user-visible presentation and interaction state",
      "signals": [
        "signal:presentation"
      ],
      "cues": [],
      "tensions": []
    },
    {
      "id": "role:telemetry-observability-adapter",
      "label": "Telemetry/observability adapter",
      "pack": "core",
      "responsibility": "emit, aggregate, or export operational observations",
      "signals": [
        "signal:observability"
      ],
      "cues": [],
      "tensions": []
    },
    {
      "id": "role:registry-authority",
      "label": "Registry authority",
      "pack": "core",
      "responsibility": "own canonical registration, identity, lookup, or policy state",
      "signals": [
        "signal:authority"
      ],
      "cues": [],
      "tensions": [
        "signal:extension"
      ]
    },
    {
      "id": "role:pure-predicate-decision-function",
      "label": "Pure predicate/decision function",
      "pack": "core",
      "responsibility": "compute one bounded deterministic decision from explicit inputs without state or side effects",
      "signals": [
        "signal:decision"
      ],
      "cues": [
        "match",
        "filter",
        "predicate",
        "decide",
        "eligible"
      ],
      "tensions": []
    }
  ],
  "questions": [
    {
      "id": "signal:simulation-state",
      "pack": "simulation",
      "question": "Does it own the canonical evolving state of a simulated system at one logical instant?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "outgoingCalls"
      ]
    },
    {
      "id": "signal:simulation-transition",
      "pack": "simulation",
      "question": "Does it compute one named causal law or process that changes simulated state over a timestep?",
      "projection": [
        "symbol",
        "hover",
        "outgoingCalls",
        "references"
      ]
    },
    {
      "id": "signal:simulation-integrator",
      "pack": "simulation",
      "question": "Does it combine multiple simulation processes into one atomic committed state transition?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "outgoingCalls"
      ]
    },
    {
      "id": "signal:simulation-timebase",
      "pack": "simulation",
      "question": "Does it decide when, by how much, or under which regime logical simulation time advances?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "outgoingCalls"
      ]
    },
    {
      "id": "signal:simulation-event",
      "pack": "simulation",
      "question": "Does it apply a bounded discrete occurrence or disturbance to simulated state?",
      "projection": [
        "symbol",
        "hover",
        "outgoingCalls",
        "references"
      ]
    },
    {
      "id": "signal:simulation-scenario",
      "pack": "simulation",
      "question": "Does it construct a complete valid initial simulated world from a scenario, preset, or seed?",
      "projection": [
        "symbol",
        "hover",
        "outgoingCalls",
        "references"
      ]
    },
    {
      "id": "signal:simulation-parameters",
      "pack": "simulation",
      "question": "Does it own coefficients, thresholds, enabled processes, or regime policy governing the model rather than evolved state?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "references"
      ]
    },
    {
      "id": "signal:simulation-observable",
      "pack": "simulation",
      "question": "Does it derive a domain quantity from one canonical snapshot without affecting the simulated trajectory?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "outgoingCalls"
      ]
    },
    {
      "id": "signal:simulation-trajectory",
      "pack": "simulation",
      "question": "Does it retain time-indexed committed states or observations without becoming current-state authority?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "references"
      ]
    },
    {
      "id": "signal:representation",
      "pack": "core",
      "question": "Does this component primarily translate, validate, optimize, or represent a domain/program form?",
      "projection": [
        "symbol",
        "hover",
        "outgoingCalls",
        "implementations"
      ]
    },
    {
      "id": "signal:invocation",
      "pack": "core",
      "question": "Is its primary contract a callable or command surface used by an external caller?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "references"
      ]
    },
    {
      "id": "signal:execution",
      "pack": "core",
      "question": "Does it primarily schedule, dispatch, execute, or supervise continuing work?",
      "projection": [
        "symbol",
        "hover",
        "outgoingCalls",
        "implementations"
      ]
    },
    {
      "id": "signal:construction",
      "pack": "core",
      "question": "Does it primarily select, assemble, configure, or return another component?",
      "projection": [
        "symbol",
        "hover",
        "outgoingCalls",
        "references"
      ]
    },
    {
      "id": "signal:extension",
      "pack": "core",
      "question": "Does it host independently supplied implementations behind a versioning or compatibility boundary?",
      "projection": [
        "symbol",
        "implementations",
        "typeHierarchy",
        "references"
      ]
    },
    {
      "id": "signal:continuity",
      "pack": "core",
      "question": "Does it own logical session, connection, or subscription continuity independently of its substrate?",
      "projection": [
        "symbol",
        "hover",
        "outgoingCalls",
        "incomingCalls"
      ]
    },
    {
      "id": "signal:resource",
      "pack": "core",
      "question": "Does it primarily own operations and failure semantics for an external resource or process?",
      "projection": [
        "symbol",
        "hover",
        "outgoingCalls",
        "references"
      ]
    },
    {
      "id": "signal:bootstrap",
      "pack": "core",
      "question": "Does it own one-time top-level application initialization and startup?",
      "projection": [
        "symbol",
        "incomingCalls",
        "outgoingCalls",
        "references"
      ]
    },
    {
      "id": "signal:presentation",
      "pack": "core",
      "question": "Does it primarily coordinate user-visible presentation or interaction state?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "outgoingCalls"
      ]
    },
    {
      "id": "signal:observability",
      "pack": "core",
      "question": "Does it primarily emit, aggregate, or export operational observations?",
      "projection": [
        "symbol",
        "hover",
        "outgoingCalls",
        "references"
      ]
    },
    {
      "id": "signal:authority",
      "pack": "core",
      "question": "Does it primarily own canonical identity, registration, policy, or durable state authority?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "references"
      ]
    },
    {
      "id": "signal:decision",
      "pack": "core",
      "question": "Does it compute a pure bounded decision from explicit inputs without owning state, effects, or representation lifecycle?",
      "projection": [
        "symbol",
        "hover",
        "incomingCalls",
        "outgoingCalls",
        "references"
      ]
    }
  ],
  "facets": [
    {
      "id": "facet:canonical-state",
      "pack": "simulation",
      "question": "Does it own committed evolving simulation state?"
    },
    {
      "id": "facet:state-transition",
      "pack": "simulation",
      "question": "Can it change the future simulated trajectory?"
    },
    {
      "id": "facet:derived-only",
      "pack": "simulation",
      "question": "Is it observational only, unable to affect the simulated trajectory?"
    },
    {
      "id": "facet:continuous-process",
      "pack": "simulation",
      "question": "Is it evaluated as a background law over logical timesteps?"
    },
    {
      "id": "facet:discrete-event",
      "pack": "simulation",
      "question": "Does it represent a discontinuous occurrence at a defined cycle point?"
    },
    {
      "id": "facet:deterministic",
      "pack": "core",
      "question": "Is equal explicit input required to produce equal output?"
    },
    {
      "id": "facet:stochastic",
      "pack": "simulation",
      "question": "Does it consume randomness as part of model behavior?"
    },
    {
      "id": "facet:seeded",
      "pack": "simulation",
      "question": "Is seeded reproducibility part of its contract?"
    },
    {
      "id": "facet:multi-rate",
      "pack": "simulation",
      "question": "Can its timestep or active process regime differ from other processes?"
    },
    {
      "id": "facet:coupled",
      "pack": "simulation",
      "question": "Does it read quantities affected by other simulation processes?"
    },
    {
      "id": "facet:feedback-loop",
      "pack": "simulation",
      "question": "Does it participate in a directed causal feedback cycle?"
    },
    {
      "id": "facet:thresholded",
      "pack": "simulation",
      "question": "Does behavior switch discontinuously at named thresholds or regimes?"
    },
    {
      "id": "facet:conservative",
      "pack": "simulation",
      "question": "Must a stock, flow, energy, mass, or other budget close within a tolerance?"
    },
    {
      "id": "facet:spatial",
      "pack": "simulation",
      "question": "Is state indexed by cell, location, or region?"
    },
    {
      "id": "facet:aggregate",
      "pack": "simulation",
      "question": "Does it aggregate spatial or component state into a system-level quantity?"
    },
    {
      "id": "facet:trajectory-bearing",
      "pack": "simulation",
      "question": "Does it retain observations indexed by logical simulation time?"
    },
    {
      "id": "facet:intervention-surface",
      "pack": "simulation",
      "question": "Can a user or external caller deliberately alter model state or policy through it?"
    },
    {
      "id": "facet:approximate-model",
      "pack": "simulation",
      "question": "Does it intentionally implement a simplified, calibrated, or illustrative model rather than exact physical truth?"
    },
    {
      "id": "facet:public-observation-edge",
      "pack": "simulation",
      "question": "Does it export a domain snapshot or observation across a public boundary?"
    },
    {
      "id": "facet:boundary",
      "pack": "core",
      "question": "Does it cross a process, network, storage, or trust boundary?"
    },
    {
      "id": "facet:state",
      "pack": "core",
      "question": "Does correctness depend on retained mutable state across calls?"
    },
    {
      "id": "facet:lifecycle",
      "pack": "core",
      "question": "Does it own explicit start, stop, cancellation, or recovery transitions?"
    },
    {
      "id": "facet:concurrency",
      "pack": "core",
      "question": "Can operations overlap or be observed concurrently?"
    },
    {
      "id": "facet:persistence",
      "pack": "core",
      "question": "Does it own durable data or a rebuildable derived representation?"
    },
    {
      "id": "facet:extensibility",
      "pack": "core",
      "question": "Can independently versioned implementations be introduced?"
    },
    {
      "id": "facet:presentation",
      "pack": "core",
      "question": "Does its contract include user-visible state or interaction?"
    },
    {
      "id": "facet:observability",
      "pack": "core",
      "question": "Does its contract include telemetry, audit, or diagnostics?"
    }
  ],
  "guarantees": [
    {
      "id": "guarantee:G-SIM-STATE-SCHEMA",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:simulation-state-authority",
      "text": "Every canonical quantity has one identity, type or unit, admissible domain, and initialization rule."
    },
    {
      "id": "guarantee:G-SIM-SINGLE-AUTHORITY",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:simulation-state-authority",
      "text": "No presentation, history, persistence, or process component maintains an independently authoritative state copy."
    },
    {
      "id": "guarantee:G-SIM-STATE-VALIDITY",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:simulation-state-authority",
      "text": "Committed states satisfy finite, range, and declared cross-field constraints."
    },
    {
      "id": "guarantee:G-SIM-SNAPSHOT",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:simulation-state-authority",
      "text": "Snapshots are immutable observations of one coherent logical instant."
    },
    {
      "id": "guarantee:G-SIM-RESET",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:simulation-state-authority",
      "text": "Reset restores declared initial state, logical time, stochastic state, and history policy."
    },
    {
      "id": "guarantee:G-SIM-READ-WRITE-SET",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:transition-process",
      "text": "The process declares complete inputs and affected canonical quantities."
    },
    {
      "id": "guarantee:G-SIM-DELTA-DISCIPLINE",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:transition-process",
      "text": "The process proposes a delta or next-state contribution and cannot privately commit canonical state."
    },
    {
      "id": "guarantee:G-SIM-DT",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:transition-process",
      "text": "Behavior is defined in terms of an explicit logical timestep."
    },
    {
      "id": "guarantee:G-SIM-DETERMINISM",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:deterministic",
      "text": "Equal state, parameters, timestep, and random stream produce equal output."
    },
    {
      "id": "guarantee:G-SIM-BOUNDS",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:state-transition",
      "text": "Transitions cannot introduce invalid, non-finite, or domain-impossible committed state."
    },
    {
      "id": "guarantee:G-SIM-CAUSAL-SIGN",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:coupled",
      "text": "Important causal and monotonic directions have explicit falsifiable tests."
    },
    {
      "id": "guarantee:G-SIM-NO-HIDDEN-INPUT",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:state-transition",
      "text": "Wall clock, DOM, ambient randomness, and mutable globals cannot alter model evolution unnoticed."
    },
    {
      "id": "guarantee:G-SIM-STEP-ATOMICITY",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:coupled-step-integrator",
      "text": "Consumers observe pre-step or post-step state, never a partially updated mixture."
    },
    {
      "id": "guarantee:G-SIM-COUPLING-TOTALITY",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:coupled-step-integrator",
      "text": "Every active process participates exactly once under declared phase and ordering semantics."
    },
    {
      "id": "guarantee:G-SIM-ORDERING",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:coupled-step-integrator",
      "text": "Process ordering, simultaneous-delta combination, or convergence semantics are explicit."
    },
    {
      "id": "guarantee:G-SIM-CYCLE-CLOSURE",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:coupled-step-integrator",
      "text": "Feedback uses a declared old/new-state policy that prevents accidental same-cycle feedback."
    },
    {
      "id": "guarantee:G-SIM-TIME-ADVANCE",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:coupled-step-integrator",
      "text": "Logical model time advances exactly with committed steps."
    },
    {
      "id": "guarantee:G-SIM-REPLAY",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:seeded",
      "text": "Repeated executions from the same versioned scenario and seed reproduce the same trajectory."
    },
    {
      "id": "guarantee:G-SIM-FAILURE-ATOMICITY",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:coupled-step-integrator",
      "text": "A failed process cannot leave a partially committed simulation step."
    },
    {
      "id": "guarantee:G-SIM-TIMEBASE",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:simulation-timebase",
      "text": "Logical time is independent of rendering; pause advances zero cycles and advance(n) commits exactly n cycles without silent skip or duplication."
    },
    {
      "id": "guarantee:G-SIM-EVENT",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:event-disturbance-process",
      "text": "Trigger, payload, affected fields, random source, identity, and cycle application point are explicit."
    },
    {
      "id": "guarantee:G-SIM-SCENARIO",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:scenario-initial-condition-generator",
      "text": "A versioned scenario and seed completely and atomically produce a valid initial world distinct from evolved state."
    },
    {
      "id": "guarantee:G-SIM-PARAMETERS",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:model-parameter-authority",
      "text": "Parameter units, domains, defaults, versioning, consumers, and cycle-boundary change semantics are explicit and distinct from evolving state."
    },
    {
      "id": "guarantee:G-SIM-DERIVED-PURITY",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:derived-observable-projector",
      "text": "The observable is a pure deterministic projection with complete declared dependencies and no independent state authority."
    },
    {
      "id": "guarantee:G-SIM-TRAJECTORY",
      "pack": "simulation",
      "level": "mandatory",
      "when": "role:trajectory-history-recorder",
      "text": "Samples identify committed logical instants, cadence, before/after convention, retention, reset/load behavior, and schema compatibility without mutating current state."
    },
    {
      "id": "guarantee:G-SIM-PUBLIC-OBSERVATION-SCHEMA",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:public-observation-edge",
      "text": "The public observation declares exact field paths, names, types, units, nullability, ranges, authority status, snapshot coherence, compatibility policy, and consumer-side negative contract tests."
    },
    {
      "id": "guarantee:G-SIM-DERIVED-ONLY",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:derived-only",
      "text": "Observation cannot mutate or influence the simulated trajectory and distinguishes undefined from numeric zero."
    },
    {
      "id": "guarantee:G-SIM-RNG",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:stochastic",
      "text": "Randomness comes only from an explicit owned stream with replayable state and declared consumption semantics."
    },
    {
      "id": "guarantee:G-SIM-MULTIRATE",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:multi-rate",
      "text": "Timestep and active-process regime changes are explicit and tested at equivalence or declared tolerance boundaries."
    },
    {
      "id": "guarantee:G-SIM-FEEDBACK",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:feedback-loop",
      "text": "Feedback direction, delay, regulation or amplification, and stability expectations have falsifiable cycle tests."
    },
    {
      "id": "guarantee:G-SIM-THRESHOLD",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:thresholded",
      "text": "Behavior immediately below, at, and above every named threshold is specified and tested."
    },
    {
      "id": "guarantee:G-SIM-CONSERVATION",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:conservative",
      "text": "Stock and flow residuals close within a declared tolerance with explicit sources and sinks."
    },
    {
      "id": "guarantee:G-SIM-SPATIAL",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:spatial",
      "text": "Spatial indexing, boundaries, neighborhood semantics, and aggregation consistency are explicit."
    },
    {
      "id": "guarantee:G-SIM-AGGREGATE",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:aggregate",
      "text": "Aggregation weights, missing values, units, and consistency with source state are explicit."
    },
    {
      "id": "guarantee:G-SIM-INTERVENTION",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:intervention-surface",
      "text": "External interventions validate authority, timing, cost, affected quantities, and interaction with replay."
    },
    {
      "id": "guarantee:G-SIM-APPROXIMATION",
      "pack": "simulation",
      "level": "mandatory",
      "when": "facet:approximate-model",
      "text": "Approximation scope, calibration basis, excluded behavior, and invalid inference boundaries are explicit."
    },
    {
      "id": "guarantee:G-BOUNDARY",
      "pack": "core",
      "level": "mandatory",
      "when": "facet:boundary",
      "text": "Boundary inputs are validated and failures preserve caller-visible semantics."
    },
    {
      "id": "guarantee:G-STATE",
      "pack": "core",
      "level": "mandatory",
      "when": "facet:state",
      "text": "State transitions have one named authority and reject stale or invalid transitions."
    },
    {
      "id": "guarantee:G-LIFECYCLE",
      "pack": "core",
      "level": "mandatory",
      "when": "facet:lifecycle",
      "text": "Start, stop, cancellation, failure, and recovery are explicit and idempotent where repeated."
    },
    {
      "id": "guarantee:G-CONCURRENCY",
      "pack": "core",
      "level": "mandatory",
      "when": "facet:concurrency",
      "text": "Concurrent operations preserve ordering, ownership, and stale-work exclusion."
    },
    {
      "id": "guarantee:G-PERSISTENCE",
      "pack": "core",
      "level": "mandatory",
      "when": "facet:persistence",
      "text": "Durable authority and rebuildable derived state are distinguished and recovery is testable."
    },
    {
      "id": "guarantee:G-EXTENSION",
      "pack": "core",
      "level": "mandatory",
      "when": "facet:extensibility",
      "text": "Extension discovery, compatibility, isolation, and failure containment are explicit."
    },
    {
      "id": "guarantee:G-PRESENTATION",
      "pack": "core",
      "level": "conditional",
      "when": "facet:presentation",
      "text": "User-visible state has deterministic loading, empty, success, and failure behavior."
    },
    {
      "id": "guarantee:G-OBSERVABILITY",
      "pack": "core",
      "level": "conditional",
      "when": "facet:observability",
      "text": "Operational signals are bounded, attributable, redactable, and non-authoritative."
    },
    {
      "id": "guarantee:G-PURE-DECISION",
      "pack": "core",
      "level": "mandatory",
      "when": "role:pure-predicate-decision-function",
      "text": "The decision is total over its declared input domain, deterministic, side-effect free, and explicit about missing or invalid inputs."
    },
    {
      "id": "guarantee:G-CLI",
      "pack": "core",
      "level": "mandatory",
      "when": "role:cli-orchestrator",
      "text": "Arguments, exit codes, output channels, interruption, and partial failure form a stable contract."
    },
    {
      "id": "guarantee:G-SESSION",
      "pack": "core",
      "level": "mandatory",
      "when": "role:session-subscription-owner",
      "text": "Logical identity, reconnect, cancellation, and teardown remain distinct from transport ownership."
    },
    {
      "id": "guarantee:G-FACTORY",
      "pack": "core",
      "level": "mandatory",
      "when": "role:factory-assembler",
      "text": "Construction validates configuration and never leaks a partially initialized product."
    },
    {
      "id": "guarantee:G-API",
      "pack": "core",
      "level": "mandatory",
      "when": "role:public-api-facade",
      "text": "The public surface preserves compatibility and translates internal failures deliberately."
    }
  ]
};

/** V1 remains an exact historical witness; v2 changes are explicit, additive knowledge. */
const REPRESENTATION_QUESTIONS: TaxonomyQuestion[] = [
  { id: "signal:parses-syntax", pack: "core", when: "signal:representation", question: "Does it recognize an input syntax and construct a structured representation (rather than merely declare types)?", projection: ["symbol", "outgoingCalls"] },
  { id: "signal:validates-rules", pack: "core", when: "signal:representation", question: "Does it accept or reject a representation against explicit rules and report violations?", projection: ["symbol", "outgoingCalls"] },
  { id: "signal:transforms-form", pack: "core", when: "signal:representation", question: "Does it translate an already-established representation into a different form while preserving required meaning?", projection: ["symbol", "outgoingCalls"] },
  { id: "signal:optimizes-form", pack: "core", when: "signal:representation", question: "Does it improve a representation against an objective while preserving required semantics?", projection: ["symbol", "outgoingCalls"] },
  { id: "signal:declarations-only", pack: "core", when: "signal:representation", question: "Is this subject only declarative data or type/interface definitions, with none of the four runtime representation operations?", projection: ["symbol", "hover"] },
];
const ROLE_EVIDENCE: Record<string, string> = {
  "role:parser": "signal:parses-syntax", "role:validator-type-checker": "signal:validates-rules",
  "role:lowerer-domain-transformer": "signal:transforms-form", "role:optimizer": "signal:optimizes-form",
};
export const TAXONOMY: TaxonomyCatalog = {
  ...LAB_TAXONOMY, version: "coherence-taxonomy/v2",
  roles: LAB_TAXONOMY.roles.map(role => ROLE_EVIDENCE[role.id] ? { ...role, requires: ROLE_EVIDENCE[role.id] } : role),
  questions: [...LAB_TAXONOMY.questions, ...REPRESENTATION_QUESTIONS],
  guarantees: [...LAB_TAXONOMY.guarantees,
    { id: "guarantee:G-DETERMINISM", pack: "core", level: "mandatory", when: "facet:deterministic", text: "Equal effective inputs, including pinned policy and configuration, produce equal observable output; clocks, ordering and randomness are explicit inputs or excluded." },
    { id: "guarantee:G-PARSER", pack: "core", level: "mandatory", when: "role:parser", text: "Supported syntax maps to the declared structured population; malformed or unsupported input has explicit behavior and cannot silently erase required subjects." },
    { id: "guarantee:G-PROJECTION", pack: "core", level: "mandatory", when: "role:lowerer-domain-transformer", text: "The projection preserves required source identities and meaning, accounts for omissions, and names approximations rather than inventing evidence or authority." },
    { id: "guarantee:G-REGISTRY", pack: "core", level: "mandatory", when: "role:registry-authority", text: "Canonical identities have one named owner; references resolve or refuse, and changes preserve declared compatibility and authority boundaries." },
  ],
};
