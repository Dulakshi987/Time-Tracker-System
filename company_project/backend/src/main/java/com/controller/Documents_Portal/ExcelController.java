package com.controller.Documents_Portal;

import com.entity.Document;
import com.repository.DocumentRepository;
import com.utils.ExcelHelper;

import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.InputStream;
import java.util.List;

@RestController
@RequestMapping("/api/excel")
@CrossOrigin(origins = "http://localhost:5173")
@RequiredArgsConstructor
public class ExcelController {

    private final DocumentRepository repository;

    // DOWNLOAD TEMPLATE
    @GetMapping("/download-template")
    public void downloadTemplate(HttpServletResponse response) throws Exception {

        XSSFWorkbook workbook = new XSSFWorkbook();
        XSSFSheet sheet = workbook.createSheet("Documents");

        Row row = sheet.createRow(0);

        row.createCell(0).setCellValue("Job Type");
        row.createCell(1).setCellValue("Job WBS");
        row.createCell(2).setCellValue("Reservation No");
        row.createCell(3).setCellValue("Customer Name");
        row.createCell(4).setCellValue("Entered By");
        row.createCell(4).setCellValue("Request Time");

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

    // UPLOAD EXCEL
    @PostMapping("/upload")
    public String uploadExcel(@RequestParam("file") MultipartFile file) {

        try {

            InputStream is = file.getInputStream();

            List<Document> docs = ExcelHelper.excelToDocuments(is);

            System.out.println(docs); // DEBUG

            repository.saveAll(docs);

            return "Excel Uploaded Successfully";

        } catch (Exception e) {

            return "Error: " + e.getMessage();
        }
    }
}