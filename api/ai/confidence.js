// Central confidence policy for AI-assisted interpretation. Flow handlers may
// use these thresholds to decide whether to proceed, confirm, or fall back to
// structured options without scattering magic numbers across the codebase.
module.exports = Object.freeze({
  HIGH: 0.85,
  MEDIUM: 0.6,
});
