"use client";

import { useCallback, useState } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropzoneProps {
  onFileSelected: (file: File) => void;
  accept?: string;
}

export function Dropzone({ onFileSelected, accept = ".xlsx,.xls,.csv" }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        setFile(droppedFile);
        onFileSelected(droppedFile);
      }
    },
    [onFileSelected]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        setFile(selectedFile);
        onFileSelected(selectedFile);
      }
    },
    [onFileSelected]
  );

  const clearFile = () => {
    setFile(null);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <FileSpreadsheet className="h-8 w-8 text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground">
            {(file.size / 1024).toFixed(1)} Ko
          </p>
        </div>
        <button
          onClick={clearFile}
          className="rounded-md p-1 hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-all",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
      )}
    >
      <div className={cn(
        "rounded-full p-3 transition-colors",
        isDragging ? "bg-primary/10" : "bg-muted"
      )}>
        <Upload className={cn(
          "h-6 w-6",
          isDragging ? "text-primary" : "text-muted-foreground"
        )} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">
          Glissez un fichier ici ou <span className="text-primary">parcourir</span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Formats acceptés : Excel (.xlsx, .xls) ou CSV
        </p>
      </div>
      <input
        type="file"
        accept={accept}
        onChange={handleFileInput}
        className="hidden"
      />
    </label>
  );
}
