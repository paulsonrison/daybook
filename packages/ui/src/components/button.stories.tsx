import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
const meta = {
  title: 'Foundations/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Continue' },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true } };
export const Tertiary: Story = { args: { variant: 'tertiary' } };
export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete draft' },
};
export const Small: Story = { args: { size: 'small' } };
export const Large: Story = { args: { size: 'large' } };
