-- 021_economy_config_power_costs.sql
-- Add powerCosts section to active economy config
-- Values match current powers table: purple_cost = base_cost, green_cost = base_cost * 3

UPDATE economy_config_versions
SET config = config || '{
  "powerCosts": {
    "ORACLE":      { "greenCost": 15,  "purpleCost": 5  },
    "HALF":        { "greenCost": 30,  "purpleCost": 10 },
    "SKIP":        { "greenCost": 60,  "purpleCost": 20 },
    "SKIP_ALL":    { "greenCost": 180, "purpleCost": 60 },
    "TIME_EXTEND": { "greenCost": 15,  "purpleCost": 5  },
    "HINT":        { "greenCost": 24,  "purpleCost": 8  }
  }
}'::jsonb
WHERE is_active = true;
