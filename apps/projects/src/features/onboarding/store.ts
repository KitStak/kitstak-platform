'use client';
/** Onboarding UI state: which surface is showing (welcome dialog or guided tour) and the tour step. */
import { create } from 'zustand';

interface OnboardingState {
  readonly welcomeOpen: boolean;
  readonly tourOpen: boolean;
  readonly step: number;
  openWelcome(): void;
  closeWelcome(): void;
  startTour(step?: number): void;
  setStep(step: number): void;
  endTour(): void;
}

export const useOnboardingStore = create<OnboardingState>()((set) => ({
  welcomeOpen: false,
  tourOpen: false,
  step: 0,
  openWelcome: () => set({ welcomeOpen: true }),
  closeWelcome: () => set({ welcomeOpen: false }),
  startTour: (step = 0) => set({ tourOpen: true, welcomeOpen: false, step }),
  setStep: (step) => set({ step }),
  endTour: () => set({ tourOpen: false, step: 0 }),
}));
