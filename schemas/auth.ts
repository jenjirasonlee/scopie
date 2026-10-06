import { z } from 'zod';

// Trim and lowercase before validating, so pasted addresses with spaces still work.
const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});

export const signUpSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name').max(120),
  email,
  password: z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters'),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
