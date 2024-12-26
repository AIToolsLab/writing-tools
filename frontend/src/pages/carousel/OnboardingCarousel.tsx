import { useState } from 'react';
import classes from './styles.module.css';

interface OnboardingCarouselProps {
  onComplete: () => void;
}

const ONBOARDING_SLIDES = [
    {
      title: "Welcome to TextFocals",
      description: "Provide a simple and brief introduction to the main actions in the add-in.",

    },
    {
      title: "Benefits of using TextFocals",
      description: "benefit",

    },
    {
      title: "function",
      description: "function",

    }
  ];

export function OnboardingCarousel({ onComplete }: OnboardingCarouselProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const nextSlide = () => {
    if (currentSlide === ONBOARDING_SLIDES.length - 1) {
      onComplete();
    } else {
      setCurrentSlide(prev => prev + 1);
    }
  };

  return (
    <div className={classes.onboardingContainer}>
      <div 
        className={classes.carouselSlide} 
        style={{ transform: `translateX(-${currentSlide * 100}%)` }}
      >
        {ONBOARDING_SLIDES.map((slide, index) => (
          <div key={index} className={classes.carouselItem}>

            <h2>{slide.title}</h2>
            <p>{slide.description}</p>
          </div>
        ))}
      </div>

      <div className={classes.carouselControls}>
        <div className={classes.carouselDots}>
          {ONBOARDING_SLIDES.map((_, index) => (
            <button
              key={index}
              className={`${classes.dot} ${currentSlide === index ? classes.activeDot : ''}`}
              onClick={() => setCurrentSlide(index)}
            />
          ))}
        </div>
        <button 
          className={classes.nextButton}
          onClick={nextSlide}
        >
          {currentSlide === ONBOARDING_SLIDES.length - 1 ? 'Get Started' : 'Next'}
        </button>
      </div>
    </div>
  );
}