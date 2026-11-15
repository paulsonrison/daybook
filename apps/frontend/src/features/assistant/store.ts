'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import { assistantRequest } from '@/lib/graphql/client';
export interface AssistantReply {
  status: string;
  answer: string | null;
  facts: string | null;
  asOf: string | null;
}
export class AssistantStore {
  question = '';
  month = '';
  reply: AssistantReply | null = null;
  busy = false;
  error = '';
  private generation = 0;
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  setQuestion(value: string) {
    this.question = value;
  }
  setMonth(value: string) {
    this.month = value;
  }
  async ask() {
    if (this.busy || !this.question.trim()) return;
    const generation = ++this.generation;
    this.busy = true;
    this.error = '';
    this.reply = null;
    try {
      const result = await assistantRequest<{ askAssistant: AssistantReply }>({
        question: this.question,
        ...(this.month ? { month: this.month } : {}),
      });
      runInAction(() => {
        if (generation === this.generation) this.reply = result.askAssistant;
      });
    } catch (error) {
      runInAction(() => {
        if (generation === this.generation)
          this.error =
            error instanceof Error
              ? error.message
              : 'Assistant request could not be confirmed.';
      });
    } finally {
      runInAction(() => {
        if (generation === this.generation) this.busy = false;
      });
    }
  }
  dispose() {
    this.generation++;
    this.reply = null;
    this.busy = false;
  }
}
