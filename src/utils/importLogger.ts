// utils/importLogger.ts - Enhanced for multi-tenant
export interface ImportLogEntry {
	studioId: string;
	source: string;
	operation: string;
	recordType: string;
	recordId?: string;
	externalId?: string;
	status: 'SUCCESS' | 'ERROR' | 'WARNING' | 'SKIPPED';
	errorMessage?: string;
	importData?: any;
	changes?: any;
}

class ImportLogger {
	private logs: ImportLogEntry[] = [];

	async log(entry: ImportLogEntry) {
		// Add to memory for immediate response
		this.logs.push(entry);

		// Persist to database for audit trail
		try {
			await prisma.importLog.create({
				data: {
					studioId: entry.studioId,
					source: entry.source,
					operation: entry.operation,
					recordType: entry.recordType,
					recordId: entry.recordId,
					externalId: entry.externalId,
					status: entry.status,
					errorMessage: entry.errorMessage,
					importData: entry.importData,
					changes: entry.changes,
				},
			});
		} catch (dbError) {
			console.error('Failed to persist import log:', dbError);
		}

		// Console logging for development
		const level =
			entry.status === 'ERROR'
				? 'error'
				: entry.status === 'WARNING'
				? 'warn'
				: 'info';
		console[level](
			`[${entry.source}] ${entry.recordType}:`,
			entry.errorMessage || 'Success',
			entry.importData
		);
	}

	getLogs() {
		return this.logs;
	}

	getErrors() {
		return this.logs.filter((log) => log.status === 'ERROR');
	}

	clear() {
		this.logs = [];
	}
}

export const logger = new ImportLogger();
