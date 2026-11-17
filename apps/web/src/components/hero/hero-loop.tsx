'use client';

import { useEffect, useRef, useState } from 'react';
import { observeVisibility, prefersReducedMotion } from '../use-reveal';
import styles from './hero-loop.module.css';

const VIDEO_WIDTH = 1600;
const VIDEO_HEIGHT = 1058;
const POSTER = '/hero/chip-poster.jpg';

/**
 * Looping render of the KitStak chip wired to the app chips. Decorative: the headline carries the
 * meaning. Plays only while on screen, stays on its poster under reduced motion until the visitor
 * presses play, and can always be paused.
 */
export function HeroLoop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isUserPaused, setIsUserPaused] = useState(false);
  const [hasUserStarted, setHasUserStarted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isUserPaused) {
      video.pause();
      return;
    }
    if (prefersReducedMotion() && !hasUserStarted) return;
    return observeVisibility(video, (isVisible) => {
      if (!isVisible) {
        video.pause();
        return;
      }
      // A blocked autoplay leaves the poster up and the button on "Play", which is the right fallback.
      video.play().catch(() => setIsPlaying(false));
    });
  }, [isUserPaused, hasUserStarted]);

  function toggle() {
    if (isPlaying) {
      setIsUserPaused(true);
      return;
    }
    setHasUserStarted(true);
    setIsUserPaused(false);
  }

  return (
    <div className={styles.visual}>
      <video
        ref={videoRef}
        className={styles.video}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        poster={POSTER}
        preload="none"
        muted
        loop
        playsInline
        disablePictureInPicture
        aria-hidden
        tabIndex={-1}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      >
        <source src="/hero/chip-loop.webm" type="video/webm" />
        <source src="/hero/chip-loop.mp4" type="video/mp4" />
      </video>
      <button
        type="button"
        className={styles.toggle}
        onClick={toggle}
        aria-label={isPlaying ? 'Pause background animation' : 'Play background animation'}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          {isPlaying ? (
            <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />
          ) : (
            <path d="M5 3l8 5-8 5z" fill="currentColor" />
          )}
        </svg>
      </button>
    </div>
  );
}
