/**
 * The app's button. Renders a <button>, or an <a> when `href` is given.
 *
 * Colours come from the tokens in `@/theme.css`, which each entry point
 * imports; this component does not import it itself, to keep the global
 * stylesheet a decision of the page rather than a side effect of a button.
 */
import type {
	AnchorHTMLAttributes,
	ButtonHTMLAttributes,
	MouseEvent,
	ReactNode,
} from 'react';
import classes from './styles.module.css';

interface StyleProps {
	color?: 'primary' | 'neutral';
	variant?: 'solid' | 'outline' | 'ghost';
	size?: 'small' | 'medium' | 'large';
	/** Shows a spinner and makes the button inactive. */
	loading?: boolean;
	disabled?: boolean;
	className?: string;
	children?: ReactNode;
}

type LinkProps = StyleProps &
	Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof StyleProps> & {
		href: string;
	};

type NativeButtonProps = StyleProps &
	Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof StyleProps> & {
		href?: undefined;
	};

export type ButtonProps = LinkProps | NativeButtonProps;

export function Button(props: ButtonProps) {
	const {
		color = 'neutral',
		variant = 'solid',
		size = 'medium',
		loading = false,
		disabled = false,
		className,
		children,
	} = props;
	const inactive = disabled || loading;

	const classNames = [
		classes.button,
		classes[color],
		classes[variant],
		classes[size],
		inactive && classes.inactive,
		className,
	]
		.filter(Boolean)
		.join(' ');

	const content = (
		<>
			{loading ? (
				<span className={classes.spinner} aria-hidden="true" />
			) : null}
			{children}
		</>
	);

	if (props.href !== undefined) {
		const {
			color: _color,
			variant: _variant,
			size: _size,
			loading: _loading,
			disabled: _disabled,
			className: _className,
			children: _children,
			href,
			onClick,
			...anchorProps
		} = props;
		// An <a> without href is not a link: it can't be focused, followed, or
		// opened in a new tab, which is what "disabled" should mean here.
		return (
			<a
				{...anchorProps}
				className={classNames}
				href={inactive ? undefined : href}
				onClick={
					inactive
						? (event: MouseEvent<HTMLAnchorElement>) =>
								event.preventDefault()
						: onClick
				}
				aria-disabled={inactive || undefined}
			>
				{content}
			</a>
		);
	}

	const {
		color: _color,
		variant: _variant,
		size: _size,
		loading: _loading,
		disabled: _disabled,
		className: _className,
		children: _children,
		href: _href,
		type,
		...buttonProps
	} = props;
	return (
		<button
			{...buttonProps}
			type={type ?? 'button'}
			className={classNames}
			disabled={inactive}
		>
			{content}
		</button>
	);
}
