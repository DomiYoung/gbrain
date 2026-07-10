/**
 * CLI 操作日志记录器
 * 记录所有 gbrain CLI 命令的执行情况
 */

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getConnection } from './core/db.ts';

export interface CliOperationResult {
  success: boolean;
  duration: number;
  rowsAffected?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface CliOperationEntry {
  timestamp: string;
  operation_type: 'cli';
  command: string;
  command_args: Record<string, any>;
  duration_ms: number;
  status: 'success' | 'error';
  rows_affected?: number;
  error_message?: string;
  user_agent?: string;
}

/**
 * 记录 CLI 操作到数据库和 JSONL 文件
 */
export async function logCliOperation(
  command: string,
  args: Record<string, any>,
  result: CliOperationResult,
): Promise<void> {
  const entry: CliOperationEntry = {
    timestamp: new Date().toISOString(),
    operation_type: 'cli',
    command,
    command_args: args,
    duration_ms: result.duration,
    status: result.success ? 'success' : 'error',
    rows_affected: result.rowsAffected,
    error_message: result.error,
    user_agent: process.env.USER || 'unknown',
  };

  try {
    // 写入数据库
    const db = getConnection();
    await db`
      INSERT INTO llm_call_log (
        created_at,
        operation_type,
        source,
        model,
        command,
        command_args,
        duration_ms,
        status,
        error_message,
        rows_affected,
        tokens_input,
        tokens_output,
        tokens_cache_read,
        cost_usd
      ) VALUES (
        ${entry.timestamp},
        ${entry.operation_type},
        ${'cli'},
        ${'none'},
        ${entry.command},
        ${JSON.stringify(entry.command_args)},
        ${entry.duration_ms},
        ${entry.status},
        ${entry.error_message || null},
        ${entry.rows_affected || null},
        ${0}, ${0}, ${0}, ${0}
      )
    `;

    // 写入 JSONL 文件
    const auditPath = resolve(process.env.HOME || '/tmp', '.gbrain/audit/cli-operations.jsonl');
    appendFileSync(auditPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    // 静默失败，不影响主操作
    console.error('[cli-logger] Failed to log operation:', err);
  }
}

/**
 * CLI 命令包装器：自动记录执行
 */
export function withCliLogging<T extends (...args: any[]) => Promise<any>>(
  command: string,
  fn: T,
): T {
  return (async (...args: any[]) => {
    const startTime = Date.now();
    const commandArgs = args[0] || {};
    
    try {
      const result = await fn(...args);
      
      await logCliOperation(command, commandArgs, {
        success: true,
        duration: Date.now() - startTime,
        rowsAffected: result?.rowsAffected || result?.count || result?.length,
        metadata: result?.metadata,
      });
      
      return result;
    } catch (error: any) {
      await logCliOperation(command, commandArgs, {
        success: false,
        duration: Date.now() - startTime,
        error: error.message,
      });
      
      throw error;
    }
  }) as T;
}
