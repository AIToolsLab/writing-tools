declare module 'reshaped' {
  import { FC, ReactNode } from 'react';

  export interface ReshapedProps {
    theme?: string;
    children?: ReactNode;
  }

  export interface ButtonProps {
    type?: 'button' | 'submit' | 'reset';
    variant?: 'solid' | 'outline' | 'ghost' | 'faded';
    color?: 'primary' | 'critical' | 'positive' | 'neutral' | 'media' | 'inherit';
    size?: 'xlarge' | 'large' | 'medium' | 'small';
    icon?: React.ComponentType<any>;
    endIcon?: React.ComponentType<any>;
    rounded?: boolean;
    disabled?: boolean;
    loading?: boolean;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    children?: ReactNode;
    attributes?: Record<string, any>;
    fullWidth?: boolean;
    highlighted?: boolean;
    elevated?: boolean;
  }

  export interface TabsProps {
    variant?: 'pills' | 'pills-elevated' | 'underlined';
    name?: string;
    value?: string;
    onChange?: (event: { value: string }) => void;
    children?: ReactNode;
  }

  export interface TabsListProps {
    children?: ReactNode;
  }

  export interface TabsItemProps {
    key?: string;
    value?: string;
    'data-active'?: string;
    children?: ReactNode;
  }

  export const Reshaped: FC<ReshapedProps>;
  export const Button: FC<ButtonProps>;

  export const Tabs: FC<TabsProps> & {
    List: FC<TabsListProps>;
    Item: FC<TabsItemProps>;
  };
}
