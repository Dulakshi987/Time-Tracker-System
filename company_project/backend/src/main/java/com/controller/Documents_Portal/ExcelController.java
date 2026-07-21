package com.controller.Documents_Portal;

import com.entity.Document;
import com.repository.DocumentRepository;
import com.utils.ExcelHelper;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;

import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.CellStyle;   // NEW
import org.apache.poi.ss.usermodel.DataFormat;  // NEW
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.InputStream;
import java.util.List;

@RestController
@RequestMapping("/api/excel")
@CrossOrigin(origins = "http://localhost:5173")
public class ExcelController {

    @Autowired
    private DocumentRepository repository;

    // =========================================
    // DOWNLOAD EXCEL TEMPLATE
    // =========================================

    @GetMapping("/download-template")
    public void downloadTemplate(
            HttpServletResponse response
    ) throws Exception {

        XSSFWorkbook workbook = new XSSFWorkbook();
        XSSFSheet sheet = workbook.createSheet("Documents");

        // HEADER ROW — order must match ExcelHelper.excelToDocuments()
        Row row = sheet.createRow(0);

        row.createCell(0).setCellValue("Job Type");
        row.createCell(1).setCellValue("Division");
        row.createCell(2).setCellValue("Job WBS");
        row.createCell(3).setCellValue("Reservation No");
        row.createCell(4).setCellValue("Customer Name");
        row.createCell(5).setCellValue("Entered By");
        row.createCell(6).setCellValue("Requested By");
        row.createCell(7).setCellValue("Vehicle No");
        row.createCell(8).setCellValue("SAP Issue Line No");
        row.createCell(9).setCellValue("Request Date");
        row.createCell(10).setCellValue("Request Time");

        // force text format on columns that could get mis-typed as numbers
        CellStyle textStyle = workbook.createCellStyle();
        DataFormat format = workbook.createDataFormat();
        textStyle.setDataFormat(format.getFormat("@"));
        sheet.setDefaultColumnStyle(5, textStyle); // Entered By
        sheet.setDefaultColumnStyle(6, textStyle); // Requested By

        response.setContentType(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        response.setHeader(
                "Content-Disposition",
                "attachment; filename=document_template.xlsx"
        );

        workbook.write(response.getOutputStream());
        workbook.close();
    }

    // =========================================
    // UPLOAD EXCEL FILE
    // =========================================

    @PostMapping("/upload")
    public ResponseEntity<?> uploadExcel(
            @RequestParam("file") MultipartFile file
    ) {
        try {
            System.out.println("UPLOAD API HIT");

            InputStream is = file.getInputStream();

            List<Document> docs = ExcelHelper.excelToDocuments(is);

            System.out.println("TOTAL DOCS = " + docs.size());

            repository.saveAll(docs);

            return ResponseEntity.ok("Excel Uploaded Successfully");

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body("ERROR : " + e.getMessage());
        }
    }
}