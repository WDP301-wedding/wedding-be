-- Add the enum in a separate committed migration before using it in constraints.
ALTER TYPE "BillingSourceType" ADD VALUE 'CONTRACT';
