// Formatowanie dat do wyświetlania.

export const formatDate = (value) =>
  new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export const day = (value) => value?.slice(0, 10) ?? "…";
