export type UserRole = 'USER' | 'ADMIN';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type { CNPJInfo } from '@/services/brasil-api';

export interface TokenPackage {
  tokens: number;
  price: number;
  discount: number;
}

export interface UserWithStats {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tokenBalance: number;
  monthlyTokenLimit: number;
  isActive: boolean;
  createdAt: Date;
  _count?: {
    sites: number;
  };
}
