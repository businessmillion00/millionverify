import axios, { AxiosInstance } from 'axios';
import { timingSafeEqual } from 'crypto';

interface AsaasCustomer {
  id: string;
  name: string;
  email: string;
  cpfCnpj: string;
}

interface AsaasPaymentRequest {
  customer: string;
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
}

interface AsaasPaymentResponse {
  id: string;
  dateCreated: string;
  customer: string;
  value: number;
  netValue: number;
  status: string;
  dueDate: string;
  invoiceUrl: string;
}

interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

class AsaasService {
  private client: AxiosInstance;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ASAAS_API_KEY || '';
    this.client = axios.create({
      baseURL: process.env.ASAAS_API_URL || 'https://api.asaas.com/v3',
      headers: {
        'access_token': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async createCustomer(data: {
    name: string;
    email: string;
    cpfCnpj: string;
    phone?: string;
  }): Promise<AsaasCustomer> {
    try {
      const response = await this.client.post('/customers', {
        name: data.name,
        email: data.email,
        cpfCnpj: data.cpfCnpj.replace(/\D/g, ''),
        phone: data.phone,
        notificationDisabled: false,
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao criar cliente no Asaas:', error);
      throw new Error('Falha ao criar cliente no Asaas');
    }
  }

  async createPayment(data: AsaasPaymentRequest): Promise<AsaasPaymentResponse> {
    try {
      const response = await this.client.post('/payments', {
        customer: data.customer,
        billingType: 'PIX',
        value: data.value,
        dueDate: data.dueDate,
        description: data.description,
        externalReference: data.externalReference,
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao criar pagamento no Asaas:', error);
      throw new Error('Falha ao criar pagamento no Asaas');
    }
  }

  async getPixQrCode(paymentId: string): Promise<AsaasPixQrCode> {
    try {
      const response = await this.client.get(`/payments/${paymentId}/pixQrCode`);
      return response.data;
    } catch (error) {
      console.error('Erro ao gerar QR Code PIX:', error);
      throw new Error('Falha ao gerar QR Code PIX');
    }
  }

  async getPayment(paymentId: string): Promise<AsaasPaymentResponse> {
    try {
      const response = await this.client.get(`/payments/${paymentId}`);
      return response.data;
    } catch (error) {
      console.error('Erro ao buscar pagamento no Asaas:', error);
      throw new Error('Falha ao buscar pagamento no Asaas');
    }
  }

  async refundPayment(paymentId: string, amount?: number): Promise<{ id: string }> {
    try {
      const response = await this.client.post(`/payments/${paymentId}/refund`, {
        ...(amount && { value: amount }),
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao fazer reembolso no Asaas:', error);
      throw new Error('Falha ao fazer reembolso no Asaas');
    }
  }

  // Asaas autentica webhooks pelo header `asaas-access-token`, configurado no painel.
  verifyWebhookToken(receivedToken: string | null): boolean {
    const expected = process.env.ASAAS_WEBHOOK_SECRET;
    if (!expected || !receivedToken) return false;

    const a = Buffer.from(receivedToken);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
  }
}

export const asaasService = new AsaasService();
