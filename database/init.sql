CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scaling_groups (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    min_instances INTEGER NOT NULL DEFAULT 1 CHECK (min_instances >= 1 AND min_instances <= 10),
    max_instances INTEGER NOT NULL DEFAULT 10 CHECK (max_instances >= min_instances AND max_instances <= 20),
    scale_out_cpu INTEGER NOT NULL DEFAULT 70 CHECK (scale_out_cpu >= 1 AND scale_out_cpu <= 100),
    scale_out_consecutive INTEGER NOT NULL DEFAULT 2 CHECK (scale_out_consecutive >= 1),
    scale_in_cpu INTEGER NOT NULL DEFAULT 30 CHECK (scale_in_cpu >= 0 AND scale_in_cpu < scale_out_cpu),
    scale_in_consecutive INTEGER NOT NULL DEFAULT 2 CHECK (scale_in_consecutive >= 1),
    cooldown_ticks INTEGER NOT NULL DEFAULT 3 CHECK (cooldown_ticks >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS simulation_runs (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES scaling_groups(id) ON DELETE CASCADE,
    load_pattern VARCHAR(50) NOT NULL,
    total_ticks INTEGER NOT NULL,
    peak_instances INTEGER NOT NULL,
    scale_out_count INTEGER NOT NULL,
    scale_in_count INTEGER NOT NULL,
    dropped_ticks INTEGER NOT NULL,
    ticks_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed default user
INSERT INTO users (id, email, password_hash)
VALUES (1, 'admin@demo.com', '$2a$10$7799R5m76cQdK9f9B2Qp7OF7y15O9wL2uFqK4p1U0m7GgP8L6lG.G')
ON CONFLICT (id) DO NOTHING;

-- Seed default scaling group
INSERT INTO scaling_groups (id, user_id, name, min_instances, max_instances, scale_out_cpu, scale_out_consecutive, scale_in_cpu, scale_in_consecutive, cooldown_ticks)
VALUES (1, 1, 'Production Web ASG', 2, 8, 70, 2, 30, 2, 3)
ON CONFLICT (id) DO NOTHING;
