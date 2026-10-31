import type { PoolConfig } from 'mariadb';

export function mysqlConnectionConfig(
  databaseUrl: string,
  options?: { pooled?: boolean },
): PoolConfig {
  const url = new URL(databaseUrl);
  const config: PoolConfig = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    connectTimeout: 5_000,
  };
  if (options?.pooled) {
    config.connectionLimit = 20;
    config.acquireTimeout = 10_000;
  }
  const ssl = url.searchParams.get('ssl') ?? url.searchParams.get('sslmode');
  if (ssl && !['false', 'disable', '0'].includes(ssl.toLowerCase())) {
    config.ssl = {
      rejectUnauthorized: !['true', 'preferred'].includes(ssl.toLowerCase()),
    };
  }
  return config;
}
