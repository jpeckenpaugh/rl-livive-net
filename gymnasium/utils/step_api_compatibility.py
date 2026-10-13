def step_api_compatibility(step_returns, output_truncation_bool=True):
    """Return the five-value API, translating legacy four-value returns."""
    if len(step_returns) == 5:
        return step_returns
    observation, reward, done, info = step_returns
    truncated = bool(info.get("TimeLimit.truncated", False))
    return observation, reward, bool(done and not truncated), truncated, info
