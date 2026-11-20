import React from 'react';
import {
  Product,
  Supplier,
  PurchaseTransaction,
  StoreBranding,
  UserProfile,
  DeviceInfo,
} from '../types/pos';
import { PurchaseWorkstation } from './PurchaseWorkstation';

interface PurchaseEntryPageProps {
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  branding?: StoreBranding;
  currentUser?: UserProfile;
  currentDevice?: DeviceInfo;
  onSavePurchase: (purchase: PurchaseTransaction, isEdit: boolean) => void;
  onDeletePurchase?: (purchaseId: string) => void;
  onDeleteAllPurchases?: () => void;
  onAddSupplier: (supplier: Supplier) => void;
  onOpenAddProduct: () => void;
  onOpenScanner?: () => void;
  onNavigate?: (page: string) => void;
  onBackToHome?: () => void;
  scannedBarcode?: string | null;
  onClearScannedBarcode?: () => void;
}

export const PurchaseEntryPage: React.FC<PurchaseEntryPageProps> = ({
  products,
  suppliers,
  purchases,
  branding,
  currentUser,
  currentDevice,
  onSavePurchase,
  onDeletePurchase,
  onDeleteAllPurchases,
  onAddSupplier,
  onOpenAddProduct,
  onOpenScanner,
  onNavigate,
  onBackToHome,
  scannedBarcode = null,
  onClearScannedBarcode,
}) => {
  return (
    <PurchaseWorkstation
      variant="old"
      products={products}
      suppliers={suppliers}
      purchases={purchases}
      branding={branding}
      currentUser={currentUser}
      currentDevice={currentDevice}
      onSavePurchase={onSavePurchase}
      onDeletePurchase={onDeletePurchase}
      onDeleteAllPurchases={onDeleteAllPurchases}
      onAddSupplier={onAddSupplier}
      onOpenAddProduct={onOpenAddProduct}
      onOpenScanner={onOpenScanner}
      onNavigate={onNavigate}
      onBackToHome={onBackToHome}
      scannedBarcode={scannedBarcode}
      onClearScannedBarcode={onClearScannedBarcode}
    />
  );
};
