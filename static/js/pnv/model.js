/**
 * Petri Net model classes.
 * Extracted from YAPNE (Yet Another Petri Net Editor).
 */

class PetriNetElement {
  constructor(id, position, label = "") {
    this.id = id;
    this.position = position;
    this.label = label;
  }
}

class Place extends PetriNetElement {
  constructor(id, position, label = "", tokens = 0, capacity = null, finalMarking = null) {
    super(id, position, label);
    this.tokens = tokens;
    this.capacity = capacity;
    this.finalMarking = finalMarking;
    this.radius = 20;
  }

  hasReachedFinalMarking() {
    return this.finalMarking !== null && this.tokens === this.finalMarking;
  }

  hasFinalMarking() {
    return this.finalMarking !== null && this.finalMarking >= 0;
  }

  addTokens(count) {
    if (this.capacity !== null && this.tokens + count > this.capacity) return false;
    this.tokens += count;
    return true;
  }

  removeTokens(count) {
    if (this.tokens - count < 0) return false;
    this.tokens -= count;
    return true;
  }
}

class Transition extends PetriNetElement {
  constructor(id, position, label = "", priority = 1, delay = 0, silent = false) {
    super(id, position, label);
    this.width = 20;
    this.height = 50;
    this.isEnabled = false;
    this.priority = priority;
    this.delay = delay;
    this.silent = silent;
  }
}

class Arc {
  constructor(id, source, target, weight = 1, type = "regular", points = [], label = "") {
    this.id = id;
    this.source = source;
    this.target = target;
    this.weight = weight;
    this.type = type;
    this.points = points;
    this.label = label;
  }
}

class PetriNet {
  constructor(id, name = "New Petri Net", description = "") {
    this.id = id;
    this.name = name;
    this.places = new Map();
    this.transitions = new Map();
    this.arcs = new Map();
    this.description = description;
  }

  addPlace(place) { this.places.set(place.id, place); }
  getPlace(id) { return this.places.get(id); }
  removePlace(id) {
    this.arcs.forEach((arc, arcId) => {
      if (arc.source === id || arc.target === id) this.arcs.delete(arcId);
    });
    return this.places.delete(id);
  }

  addTransition(transition) { this.transitions.set(transition.id, transition); }
  getTransition(id) { return this.transitions.get(id); }
  removeTransition(id) {
    this.arcs.forEach((arc, arcId) => {
      if (arc.source === id || arc.target === id) this.arcs.delete(arcId);
    });
    return this.transitions.delete(id);
  }

  addArc(arc) {
    const sourceExists = this.places.has(arc.source) || this.transitions.has(arc.source);
    const targetExists = this.places.has(arc.target) || this.transitions.has(arc.target);
    if (!sourceExists || !targetExists) return false;
    const sourceIsPlace = this.places.has(arc.source);
    const targetIsPlace = this.places.has(arc.target);
    if (sourceIsPlace === targetIsPlace) return false;
    this.arcs.set(arc.id, arc);
    return true;
  }
  getArc(id) { return this.arcs.get(id); }
  removeArc(id) { return this.arcs.delete(id); }

  updateEnabledTransitions() {
    for (const [id] of this.transitions) {
      this.transitions.get(id).isEnabled = this.isTransitionEnabled(id);
    }
  }

  isTransitionEnabled(transitionId) {
    for (const arc of this.arcs.values()) {
      if (arc.target !== transitionId) continue;
      const place = this.places.get(arc.source);
      if (!place) continue;
      if (arc.type === "inhibitor" && place.tokens >= arc.weight) return false;
      if (arc.type === "regular" && place.tokens < arc.weight) return false;
    }
    return true;
  }

  fireTransition(transitionId) {
    if (!this.isTransitionEnabled(transitionId)) return false;
    const incoming = Array.from(this.arcs.values()).filter(a => a.target === transitionId);
    const outgoing = Array.from(this.arcs.values()).filter(a => a.source === transitionId);
    for (const arc of incoming) {
      const place = this.places.get(arc.source);
      if (!place) continue;
      if (arc.type === "regular") place.removeTokens(arc.weight);
      else if (arc.type === "reset") place.tokens = 0;
    }
    for (const arc of outgoing) {
      const place = this.places.get(arc.target);
      if (place) place.addTokens(arc.weight);
    }
    return true;
  }

  resolveConflicts(enabledIds) {
    if (enabledIds.length <= 1) return enabledIds;
    const conflictGroups = new Map();
    for (const transId of enabledIds) {
      for (const arc of this.arcs.values()) {
        if (arc.target !== transId || arc.type !== "regular") continue;
        if (!conflictGroups.has(arc.source)) conflictGroups.set(arc.source, []);
        conflictGroups.get(arc.source).push({ transitionId: transId, weight: arc.weight });
      }
    }
    const toFire = new Set(enabledIds);
    for (const [placeId, transitions] of conflictGroups) {
      if (transitions.length <= 1) continue;
      const place = this.places.get(placeId);
      if (!place) continue;
      const totalRequired = transitions.reduce((s, t) => s + t.weight, 0);
      if (place.tokens >= totalRequired) continue;
      const details = transitions.map(t => ({
        id: t.transitionId,
        priority: this.transitions.get(t.transitionId)?.priority || 1,
        weight: t.weight
      }));
      details.sort((a, b) => b.priority !== a.priority ? b.priority - a.priority : Math.random() - 0.5);
      let available = place.tokens;
      for (const t of details) {
        if (available >= t.weight && toFire.has(t.id)) {
          available -= t.weight;
        } else {
          toFire.delete(t.id);
        }
      }
    }
    return Array.from(toFire);
  }

  fireTransitionsSynchronously(transitionIds) {
    const enabled = transitionIds.filter(id => this.isTransitionEnabled(id));
    if (enabled.length === 0) return false;
    const toFire = this.resolveConflicts(enabled);
    if (toFire.length === 0) return false;
    const deltas = new Map();
    for (const transitionId of toFire) {
      for (const arc of this.arcs.values()) {
        if (arc.target === transitionId) {
          const place = this.places.get(arc.source);
          if (!place) continue;
          if (arc.type === "regular") deltas.set(arc.source, (deltas.get(arc.source) || 0) - arc.weight);
          else if (arc.type === "reset") deltas.set(arc.source, -place.tokens);
        }
        if (arc.source === transitionId) {
          const place = this.places.get(arc.target);
          if (place) deltas.set(arc.target, (deltas.get(arc.target) || 0) + arc.weight);
        }
      }
    }
    for (const [placeId, delta] of deltas) {
      const place = this.places.get(placeId);
      if (!place) continue;
      place.tokens = Math.max(0, place.tokens + delta);
      if (place.capacity !== null) place.tokens = Math.min(place.tokens, place.capacity);
    }
    return true;
  }

  toJSON() {
    return JSON.stringify({
      id: this.id,
      name: this.name,
      description: this.description,
      places: Array.from(this.places.values()),
      transitions: Array.from(this.transitions.values()),
      arcs: Array.from(this.arcs.values())
    });
  }

  static fromJSON(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const net = new PetriNet(data.id, data.name, data.description);
    (data.places || []).forEach(d => {
      net.places.set(d.id, new Place(d.id, d.position, d.label, d.tokens, d.capacity, d.finalMarking ?? null));
    });
    (data.transitions || []).forEach(d => {
      const silent = d.silent || !d.label || d.label.trim() === '';
      net.transitions.set(d.id, new Transition(d.id, d.position, d.label || '', d.priority, d.delay, silent));
    });
    (data.arcs || []).forEach(d => {
      net.arcs.set(d.id, new Arc(d.id, d.source, d.target, d.weight, d.type, d.points || [], d.label));
    });
    return net;
  }

  static generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
}
