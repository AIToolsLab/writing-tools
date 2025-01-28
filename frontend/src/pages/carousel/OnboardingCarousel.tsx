import { useState } from 'react';
import classes from './styles.module.css';
import descriptionImage from '../../../assets/c1.png'
import functionImage from '../../../assets/logo_black.png'
import benefitsImage from '../../../assets/c3.png'

interface OnboardingCarouselProps {
  onComplete: () => void;
}

const ONBOARDING_SLIDES = [
    {
      title: "Welcome to TextFocals",
      image: functionImage,
      description: "Thoughtful helps you write more thoughtfully. Its AI encourages your own thinking.",
      
    },
    {
      title: "Benefits of using TextFocals",
      description: "benefit",
      image: descriptionImage

    },
    {
      title: "function",
      description: "function",
      image: benefitsImage
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
            <img src={slide.image} className={classes.carouselImage}/>
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
        <div className={classes.carouselButtons}>

        {currentSlide !==ONBOARDING_SLIDES.length - 1 && <button 
          className={classes.skipButton}
          onClick={onComplete}
        >
            Skip
          </button>}

        <button 
          className={classes.nextButton}
          onClick={nextSlide}
        >
          {currentSlide === ONBOARDING_SLIDES.length - 1 ? 'Get Started' : 'Next'}
        </button>

        </div>
      </div>
    </div>
  );
}