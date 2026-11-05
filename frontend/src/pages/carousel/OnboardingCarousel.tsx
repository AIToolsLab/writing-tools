import { useState } from 'react';
import { Button } from 'reshaped';
import classes from './styles.module.css';

interface OnboardingCarouselProps {
	onComplete: () => void;
}

const ONBOARDING_SLIDES = [
	{
		title: 'Welcome to Thoughtful',
		description:
			'Writing is thinking. Thoughtful uses AI to support that thinking, not replace it. You own every word.',
	},
	{
		title: 'Draft',
		description:
			"For the part you're working on: what might a reader ask, and what might a writing coach suggest you try next?",
	},
	{
		title: 'Revise',
		description:
			'Zoom out to see your whole draft: its outline, its main point, and where a reader might push back.',
	},
	{
		title: 'Chat',
		description:
			'Talk your draft through with a writing coach. It can point you to passages in your draft and propose edits made only from your own words. You accept or decline each one.',
	},
];

export function OnboardingCarousel({ onComplete }: OnboardingCarouselProps) {
	const [currentSlide, setCurrentSlide] = useState(0);

	const nextSlide = () => {
		if (currentSlide === ONBOARDING_SLIDES.length - 1) {
			onComplete();
		} else {
			setCurrentSlide((prev) => prev + 1);
		}
	};

	return (
		<div className={classes.onboardingContainer}>
			<div className={classes.carouselWrapper}>
				<div
					className={classes.carouselSlide}
					style={{ transform: `translateX(-${currentSlide * 100}%)` }}
				>
					{ONBOARDING_SLIDES.map((slide) => (
						<div key={slide.title} className={classes.carouselItem}>
							<div className={classes.slideContent}>
								<h2 className={classes.slideTitle}>
									{slide.title}
								</h2>
								<p className={classes.slideDescription}>
									{slide.description}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>

			<div className={classes.carouselControls}>
				<div className={classes.carouselDots}>
					{ONBOARDING_SLIDES.map((_, index) => (
						<button
							type="button"
							// biome-ignore lint/suspicious/noArrayIndexKey: it's literally the index
							key={index}
							className={`${classes.dot} ${
								currentSlide === index ? classes.activeDot : ''
							}`}
							onClick={() => setCurrentSlide(index)}
							aria-label={`Go to slide ${index + 1}`}
						/>
					))}
				</div>

				<div className={classes.carouselButtons}>
					{currentSlide !== ONBOARDING_SLIDES.length - 1 && (
						<Button
							variant="ghost"
							color="neutral"
							onClick={onComplete}
						>
							Skip
						</Button>
					)}
					<Button variant="solid" color="primary" onClick={nextSlide}>
						{currentSlide === ONBOARDING_SLIDES.length - 1
							? 'Get Started'
							: 'Next'}
					</Button>
				</div>
			</div>
		</div>
	);
}
