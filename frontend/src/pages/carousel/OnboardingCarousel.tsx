import { useState } from 'react';
import classes from './styles.module.css';
import descriptionImage from '../../../assets/c1.png';
import functionImage from '../../../assets/logo_black.png';
import benefitsImage from '../../../assets/c2.png';

interface OnboardingCarouselProps {
  onComplete: () => void;
}

const ONBOARDING_SLIDES = [
    {
      title: 'Welcome to Thoughtful',
      image: functionImage,
      description: 'Thoughtful helps you write more thoughtfully. Its AI encourages your own thinking.',
    },
    {
      title: 'Benefits',
      description: 'It helps you craft your words on a blank page, and it helps you think about what you want to say.',
      image: descriptionImage
    },
    {
      title: 'Features of Thoughtful',
      description: 'Generate new sentence, address potential reader inquiries, receive recommendations for the next word, phrase, or rhetorical move.',
      image: benefitsImage
    },
  ];

export function OnboardingCarousel({ onComplete }: OnboardingCarouselProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const nextSlide = () => {
    if (currentSlide === ONBOARDING_SLIDES.length - 1) {
      onComplete();
    }
    else {
      setCurrentSlide(prev => prev + 1);
    }
  };

  return (
    <div className={ classes.onboardingContainer }>
      <div className={ classes.carouselWrapper }>
        <div
          className={ classes.carouselSlide }
          style={ { transform: `translateX(-${currentSlide * 100}%)` } }
        >
          { ONBOARDING_SLIDES.map((slide, index) => (
            <div key={ index } className={ classes.carouselItem }>
              <div className={ classes.slideContent }>
                <h2 className={ classes.slideTitle }>{ slide.title }</h2>
                <div className={ classes.imageWrapper }>
                  <img
                    src={ slide.image }
                    alt={ slide.title }
                    className={ classes.carouselImage }
                  />
                </div>
                <p className={ classes.slideDescription }>{ slide.description }</p>
              </div>
            </div>
          )) }
        </div>
      </div>

      <div className={ classes.carouselControls }>
        <div className={ classes.carouselDots }>
          { ONBOARDING_SLIDES.map((_, index) => (
            <button
              key={ index }
              className={ `${classes.dot} ${
                currentSlide === index ? classes.activeDot : ''
              }` }
              onClick={ () => setCurrentSlide(index) }
              aria-label={  `Go to slide ${index + 1}` }
            />
          )) }
        </div>

        <div className={ classes.carouselButtons }>
          { currentSlide !== ONBOARDING_SLIDES.length - 1 && (
            <button
              className={ classes.skipButton }
              onClick={ onComplete }
            >
              Skip
            </button>
          ) }
          <button
            className={ classes.nextButton }
            onClick={ nextSlide }
          >
            { currentSlide === ONBOARDING_SLIDES.length - 1 ? 'Get Started' : 'Next' }
          </button>
        </div>
      </div>
    </div>
  );
}
