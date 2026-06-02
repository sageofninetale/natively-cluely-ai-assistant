import * as fs from 'fs';
import * as path from 'path';
import { DatabaseManager } from '../db/DatabaseManager';
import { DocType } from './types';

interface KnowledgeResult {
  isIntroQuestion?: boolean;
  introResponse?: string;
  systemPromptInjection?: string;
  contextBlock?: string;
  factualRecall?: boolean;
}

const MAX_RESUME_CHARS = 4000;
const MAX_JD_CHARS = 3000;

export class LocalKnowledgeOrchestrator {
  private knowledgeMode = false;
  private customNotes = '';

  // ── Wiring stubs (called from main.ts to match premium API) ──────────────

  setGenerateContentFn(_fn: any): void {}
  setEmbedFn(_fn: any): void {}
  setEmbedQueryFn(_fn: any): void {}
  setFastQueryEmbedFn(_fn: any): void {}
  setActiveSpaceFn(_fn: any): void {}
  setConversationContextProvider(_fn: any): void {}
  async ensureEmbeddingSpace(): Promise<void> {}
  feedForDepthScoring(_message: string): void {}

  setCustomNotes(notes: string): void {
    this.customNotes = notes;
  }

  // ── Mode ─────────────────────────────────────────────────────────────────

  isKnowledgeMode(): boolean {
    return this.knowledgeMode;
  }

  setKnowledgeMode(enabled: boolean): void {
    this.knowledgeMode = enabled;
  }

  // ── Document ingest ───────────────────────────────────────────────────────

  async ingestDocument(
    filePath: string,
    docType: DocType,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const ext = path.extname(filePath).toLowerCase();
      let rawText = '';

      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
        rawText = data.text ?? '';
      } else if (ext === '.docx') {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        rawText = result.value ?? '';
      } else {
        rawText = fs.readFileSync(filePath, 'utf-8');
      }

      rawText = rawText.trim();
      if (!rawText) {
        return { success: false, error: 'Document appears to be empty or could not be parsed.' };
      }

      const fileName = path.basename(filePath);
      DatabaseManager.getInstance().saveProfileDocument(docType, rawText, fileName);

      console.log(
        `[LocalKnowledgeOrchestrator] Ingested ${docType}: ${fileName} (${rawText.length} chars)`,
      );
      return { success: true };
    } catch (error: any) {
      console.error('[LocalKnowledgeOrchestrator] ingestDocument error:', error);
      return { success: false, error: error.message };
    }
  }

  deleteDocumentsByType(docType: DocType): void {
    try {
      DatabaseManager.getInstance().deleteProfileDocument(docType);
    } catch (e) {
      console.error('[LocalKnowledgeOrchestrator] deleteDocumentsByType error:', e);
    }
  }

  // ── Status / profile ──────────────────────────────────────────────────────

  getStatus(): {
    hasResume: boolean;
    activeMode: boolean;
    resumeSummary?: { name?: string; role?: string; totalExperienceYears?: number };
  } {
    const resumeDoc = DatabaseManager.getInstance().getProfileDocument(DocType.RESUME);
    return {
      hasResume: !!resumeDoc,
      activeMode: this.knowledgeMode,
    };
  }

  getProfileData(): any {
    const db = DatabaseManager.getInstance();
    const resumeDoc = db.getProfileDocument(DocType.RESUME);
    const jdDoc = db.getProfileDocument(DocType.JD);
    if (!resumeDoc && !jdDoc) return null;
    return {
      hasResume: !!resumeDoc,
      hasActiveJD: !!jdDoc,
      nodeCount: resumeDoc ? 1 : 0,
      activeJD: jdDoc ? { description_summary: jdDoc.raw_text.slice(0, 500) } : undefined,
    };
  }

  // Stub: company research is not available in the open-source build.
  getCompanyResearchEngine(): null {
    return null;
  }

  // Stub: negotiation features are not available in the open-source build.
  getNegotiationScript(): null {
    return null;
  }
  async generateNegotiationScriptOnDemand(): Promise<null> {
    return null;
  }
  getNegotiationTracker(): { getState: () => null; isActive: () => false } {
    return { getState: () => null, isActive: () => false };
  }
  resetNegotiationSession(): void {}

  // ── Core: question processing ─────────────────────────────────────────────

  async processQuestion(message: string): Promise<KnowledgeResult | null> {
    const db = DatabaseManager.getInstance();
    const resumeDoc = db.getProfileDocument(DocType.RESUME);
    const jdDoc = db.getProfileDocument(DocType.JD);

    if (!resumeDoc && !jdDoc) return null;

    const parts: string[] = [];

    if (resumeDoc) {
      const text =
        resumeDoc.raw_text.length > MAX_RESUME_CHARS
          ? `${resumeDoc.raw_text.slice(0, MAX_RESUME_CHARS)}...[truncated]`
          : resumeDoc.raw_text;
      parts.push(`<candidate_resume>\n${text}\n</candidate_resume>`);
    }

    if (jdDoc) {
      const text =
        jdDoc.raw_text.length > MAX_JD_CHARS
          ? `${jdDoc.raw_text.slice(0, MAX_JD_CHARS)}...[truncated]`
          : jdDoc.raw_text;
      parts.push(`<job_description>\n${text}\n</job_description>`);
    }

    const contextBlock = parts.join('\n\n');

    let systemPromptInjection: string;
    if (resumeDoc && jdDoc) {
      systemPromptInjection =
        'You are the candidate described in the attached resume, interviewing for the role in the attached job description. Answer questions about your background, experience, skills, and projects in first person, using specific details from your resume. Tailor your answers to demonstrate fit for the role.';
    } else if (resumeDoc) {
      systemPromptInjection =
        'You are the candidate described in the attached resume. When asked about your background, experience, skills, projects, or qualifications, answer in first person using the specific details from your resume.';
    } else {
      systemPromptInjection =
        'The attached job description describes the role this candidate is interviewing for. Reference it when discussing the role, its requirements, or the candidate\'s interest in the position.';
    }

    // factualRecall: true bypasses the isPremiumKnowledgeInterceptAllowed() mode gate
    // so context injection works in all modes (technical-interview, team-meet, etc.)
    return {
      contextBlock,
      systemPromptInjection,
      factualRecall: true,
    };
  }
}
