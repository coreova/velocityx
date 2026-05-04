(function (global) {
  'use strict';

  function cleanDomain(raw) {
    return String(raw || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0]
      .replace(/\.$/, '');
  }

  function isValidDomain(domain) {
    const value = cleanDomain(domain);
    if (!value || value.length > 253 || value.includes('..')) return false;
    if (value === 'localhost') return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
      return value.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
    }
    const labels = value.split('.');
    if (labels.length < 2) return false;
    return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }

  function clampRuleSpeed(speed, fallback = 1.5) {
    const parsed = Math.round((parseFloat(speed) || 0) * 100) / 100;
    return Math.max(0.07, Math.min(16, parsed || fallback));
  }

  function isRegexPattern(pattern) {
    const value = String(pattern || '').trim();
    return value.startsWith('/') && value.lastIndexOf('/') > 0;
  }

  function parseRulePattern(pattern) {
    const value = String(pattern || '').trim();
    if (!isRegexPattern(value)) return null;
    const lastSlash = value.lastIndexOf('/');
    const source = value.slice(1, lastSlash);
    const flags = value.slice(lastSlash + 1);
    if (!source) return null;
    try {
      return new RegExp(source, flags);
    } catch (_) {
      return null;
    }
  }

  function normalizeRulePattern(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    const regex = parseRulePattern(value);
    if (regex) return `/${regex.source}/${regex.flags}`;
    const domain = cleanDomain(value);
    return isValidDomain(domain) ? domain : '';
  }

  function ruleScope(pattern) {
    return parseRulePattern(pattern) ? 'regex' : 'domain';
  }

  function normalizeRule(rawPattern, rawRule, index) {
    if (!rawRule || typeof rawRule !== 'object') return null;
    const pattern = normalizeRulePattern(rawRule.pattern ?? rawPattern);
    if (!pattern) return null;
    const normalized = {
      id: rawRule.id || `rule-${index}-${pattern}`,
      pattern,
      scope: ruleScope(pattern)
    };

    if (rawRule.disabled) {
      normalized.disabled = true;
    } else if (Number.isFinite(Number(rawRule.speed))) {
      normalized.speed = clampRuleSpeed(rawRule.speed);
    }

    if (typeof rawRule.controllerCSS === 'string' && rawRule.controllerCSS.trim()) {
      normalized.controllerCSS = rawRule.controllerCSS;
    }

    return normalized;
  }

  function normalizeSiteRules(rules = {}) {
    const list = Array.isArray(rules)
      ? rules.map((rule, index) => normalizeRule(rule?.pattern, rule, index))
      : Object.entries(rules || {}).map(([pattern, rule], index) => normalizeRule(pattern, rule, index));
    const deduped = new Map();
    list.forEach(rule => {
      if (!rule) return;
      deduped.set(rule.pattern, rule);
    });
    return Array.from(deduped.values());
  }

  function hostCandidates(hostname) {
    const parts = String(hostname || '').toLowerCase().split('.').filter(Boolean);
    const candidates = [];
    for (let i = 0; i < parts.length; i++) {
      const candidate = parts.slice(i).join('.');
      if (!candidate) continue;
      if (parts.length === 1 || candidate.includes('.')) candidates.push(candidate);
    }
    return [...new Set(candidates)];
  }

  function getDomainRules(rules = []) {
    return normalizeSiteRules(rules).filter(rule => rule.scope === 'domain');
  }

  function getRegexRules(rules = []) {
    return normalizeSiteRules(rules).filter(rule => rule.scope === 'regex');
  }

  function getSiteRuleMatch(rules = {}, hostname = '', href = '') {
    const normalizedRules = normalizeSiteRules(rules);
    const domainMap = Object.create(null);
    normalizedRules.forEach(rule => {
      if (rule.scope === 'domain') domainMap[rule.pattern] = rule;
    });

    for (const candidate of hostCandidates(hostname)) {
      if (domainMap[candidate]) {
        return { domain: candidate, pattern: candidate, rule: domainMap[candidate], scope: 'domain' };
      }
    }

    const host = String(hostname || '').toLowerCase();
    const targetHref = String(href || '');
    for (const rule of normalizedRules) {
      if (rule.scope !== 'regex') continue;
      const regex = parseRulePattern(rule.pattern);
      if (!regex) continue;
      if (regex.test(targetHref || host) || regex.test(host)) {
        return { domain: host, pattern: rule.pattern, rule, scope: 'regex' };
      }
    }
    return null;
  }

  function getRuleRelations(pattern, rules = {}) {
    const normalizedPattern = normalizeRulePattern(pattern);
    const normalizedRules = normalizeSiteRules(rules);
    const exactRule = normalizedRules.find(rule => rule.pattern === normalizedPattern) || null;
    if (!exactRule) {
      return { exact: null, parents: [], children: [] };
    }
    if (exactRule.scope === 'regex') {
      return { exact: { pattern: exactRule.pattern, rule: exactRule }, parents: [], children: [] };
    }

    const domainRules = normalizedRules.filter(rule => rule.scope === 'domain');
    return {
      exact: { pattern: exactRule.pattern, rule: exactRule },
      parents: domainRules
        .filter(rule => rule.pattern !== normalizedPattern && normalizedPattern.endsWith('.' + rule.pattern))
        .map(rule => ({ pattern: rule.pattern, rule })),
      children: domainRules
        .filter(rule => rule.pattern !== normalizedPattern && rule.pattern.endsWith('.' + normalizedPattern))
        .map(rule => ({ pattern: rule.pattern, rule }))
    };
  }

  function describeRule(rule = {}) {
    if (rule.disabled) return 'Disabled';
    const parts = [];
    if (Number.isFinite(Number(rule.speed))) parts.push(`${clampRuleSpeed(rule.speed)}x`);
    if (rule.controllerCSS) parts.push('CSS');
    return parts.length ? parts.join(' + ') : 'Active';
  }

  function buildRuleNote(pattern, rules = {}) {
    const rel = getRuleRelations(pattern, rules);
    if (!rel.exact) return '';

    const notes = [];
    if (rel.exact.rule.scope === 'regex') {
      notes.push('Regex rule checks the current hostname and page URL in the order it appears here.');
    }
    if (rel.parents.length) {
      notes.push(`Takes priority over broader rule${rel.parents.length > 1 ? 's' : ''}: ${rel.parents.map(item => item.pattern).join(', ')}.`);
    }
    if (rel.children.length) {
      notes.push(`Acts as fallback for ${rel.children.map(item => item.pattern).join(', ')} unless those more specific rules override it.`);
    }
    if (rel.exact.rule.controllerCSS) {
      notes.push('Adds a page-level controller CSS override for this match.');
    }
    return notes.join(' ');
  }

  global.VelocityXSiteRules = Object.freeze({
    buildRuleNote,
    cleanDomain,
    clampRuleSpeed,
    describeRule,
    getDomainRules,
    getRegexRules,
    getRuleRelations,
    getSiteRuleMatch,
    hostCandidates,
    isRegexPattern,
    isValidDomain,
    normalizeRulePattern,
    normalizeSiteRules,
    parseRulePattern,
    ruleScope
  });
})(globalThis);
