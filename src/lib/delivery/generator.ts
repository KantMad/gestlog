import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";
import { DELIVERY_COLORS } from "@/lib/constants";

export interface GenerateDeliveriesInput {
  allocationSessionId: string;
}

export async function generateDeliveries(input: GenerateDeliveriesInput) {
  const session = await prisma.allocationSession.findUnique({
    where: { id: input.allocationSessionId },
    include: {
      lines: { include: { product: true } },
    },
  });

  if (!session) throw new Error("Session d'allocation introuvable");
  if (session.status !== "VALIDATED")
    throw new Error("La session doit être validée");

  const linesByClient = new Map<
    string,
    { clientId: string; productId: string; allocatedBySize: string; totalQuantity: number }[]
  >();

  for (const line of session.lines) {
    if (line.status !== "LIVRABLE" || !line.clientId) continue;
    const alloc = parseSizeQuantities(line.allocatedBySize);
    const total = sumQuantities(alloc);
    if (total === 0) continue;

    if (!linesByClient.has(line.clientId)) {
      linesByClient.set(line.clientId, []);
    }
    linesByClient.get(line.clientId)!.push({
      clientId: line.clientId,
      productId: line.productId,
      allocatedBySize: line.allocatedBySize,
      totalQuantity: total,
    });
  }

  const lastDelivery = await prisma.delivery.findFirst({
    orderBy: { deliveryNumber: "desc" },
  });
  let nextNumber = (lastDelivery?.deliveryNumber || 0) + 1;

  const createdDeliveries: string[] = [];

  for (const [clientId, clientLines] of linesByClient) {
    const colorIndex = (nextNumber - 1) % DELIVERY_COLORS.length;

    const delivery = await prisma.delivery.create({
      data: {
        deliveryNumber: nextNumber,
        clientId,
        allocationSessionId: session.id,
        status: "PLANIFIEE",
        colorCode: DELIVERY_COLORS[colorIndex],
        lines: {
          create: clientLines.map((cl) => ({
            productId: cl.productId,
            quantitiesBySize: cl.allocatedBySize,
            totalQuantity: cl.totalQuantity,
          })),
        },
      },
    });

    createdDeliveries.push(delivery.id);
    nextNumber++;
  }

  return { deliveryIds: createdDeliveries, count: createdDeliveries.length };
}
